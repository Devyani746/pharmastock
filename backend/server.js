require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pharmastock',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

// ============================================================================
// REST API ENDPOINTS
// ============================================================================

// 1. Health Check
app.get('/api/health', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    res.status(200).json({
      ok: true,
      service: 'PharmaStock API',
      database: 'Connected to MySQL',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. High-Level Metrics & Expiry Risk Analysis
app.get('/api/metrics', async (req, res) => {
  try {
    // Total Inventory Value (Current active batch valuation)
    const [invRows] = await pool.query(`
      SELECT IFNULL(SUM(quantity * purchase_price), 0) AS totalInventoryValue 
      FROM batches 
      WHERE quantity > 0
    `);

    // Today's Sales Revenue
    const [salesRows] = await pool.query(`
      SELECT IFNULL(SUM(total_amount), 0) AS todaySales 
      FROM orders 
      WHERE DATE(created_at) = CURDATE()
    `);

    // Pending Orders Count
    const [pendingRows] = await pool.query(`
      SELECT COUNT(*) AS pendingOrders 
      FROM orders 
      WHERE status != 'DELIVERED'
    `);

    // Working Capital at Expiry Risk Buckets
    const [riskRows] = await pool.query(`
      SELECT 
        IFNULL(SUM(CASE WHEN expiry_date < CURDATE() THEN quantity * purchase_price ELSE 0 END), 0) AS expired,
        IFNULL(SUM(CASE WHEN expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN quantity * purchase_price ELSE 0 END), 0) AS exp30,
        IFNULL(SUM(CASE WHEN expiry_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 31 DAY) AND DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN quantity * purchase_price ELSE 0 END), 0) AS exp60,
        IFNULL(SUM(CASE WHEN expiry_date BETWEEN DATE_ADD(CURDATE(), INTERVAL 61 DAY) AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN quantity * purchase_price ELSE 0 END), 0) AS exp90
      FROM batches
      WHERE quantity > 0
    `);

    // Stock-Out Prediction: (Current Available Non-Expired Stock / ADD) <= Lead Time Days
    const [stockoutRows] = await pool.query(`
      SELECT 
        m.id,
        m.average_daily_demand,
        m.lead_time_days,
        IFNULL(SUM(CASE WHEN b.expiry_date >= CURDATE() THEN b.quantity ELSE 0 END), 0) AS available_stock
      FROM medicines m
      LEFT JOIN batches b ON m.id = b.medicine_id
      GROUP BY m.id, m.average_daily_demand, m.lead_time_days
    `);

    let criticalStockCount = 0;
    stockoutRows.forEach(row => {
      const daysToStockout = row.average_daily_demand > 0 
        ? (row.available_stock / row.average_daily_demand) 
        : 999;
      if (daysToStockout <= row.lead_time_days) {
        criticalStockCount++;
      }
    });

    res.status(200).json({
      totalInventoryValue: Number(invRows[0].totalInventoryValue),
      todaySales: Number(salesRows[0].todaySales),
      pendingOrders: pendingRows[0].pendingOrders,
      criticalStockCount,
      expiryRisk: {
        expired: Number(riskRows[0].expired),
        exp30: Number(riskRows[0].exp30),
        exp60: Number(riskRows[0].exp60),
        exp90: Number(riskRows[0].exp90)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Multi-Batch Inventory Master List
app.get('/api/inventory', async (req, res) => {
  try {
    const [medicines] = await pool.query('SELECT * FROM medicines ORDER BY name ASC');
    const [batches] = await pool.query(`
      SELECT * FROM batches 
      WHERE quantity > 0 
      ORDER BY expiry_date ASC
    `);

    const result = medicines.map(med => ({
      id: med.id,
      sku: med.sku,
      name: med.name,
      composition: med.composition,
      category: med.category,
      averageDailyDemand: med.average_daily_demand,
      leadTimeDays: med.lead_time_days,
      batches: batches
        .filter(b => b.medicine_id === med.id)
        .map(b => ({
          id: b.id,
          batchNumber: b.batch_number,
          expiryDate: b.expiry_date,
          quantity: b.quantity,
          purchasePrice: Number(b.purchase_price),
          mrp: Number(b.mrp),
          supplier: b.supplier
        }))
    }));

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Inward Stock Entry (Upsert Batch)
app.post('/api/inventory/batch', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      sku,
      name,
      composition,
      batchNumber,
      manufacturingDate,
      expiryDate,
      quantity,
      purchasePrice,
      mrp,
      supplier
    } = req.body;

    if (!sku || !name || !batchNumber || !expiryDate || quantity === undefined) {
      return res.status(400).json({ error: 'Missing mandatory batch fields (sku, name, batchNumber, expiryDate, quantity)' });
    }

    await connection.beginTransaction();

    // Find or create parent medicine record
    let [meds] = await connection.query('SELECT id FROM medicines WHERE sku = ?', [sku]);
    let medicineId;

    if (meds.length > 0) {
      medicineId = meds[0].id;
    } else {
      const [insertMed] = await connection.query(
        'INSERT INTO medicines (sku, name, composition) VALUES (?, ?, ?)',
        [sku, name, composition || 'Pharmaceutical Formula']
      );
      medicineId = insertMed.insertId;
    }

    // Upsert batch entry
    await connection.query(
      `INSERT INTO batches (medicine_id, batch_number, expiry_date, quantity, purchase_price, mrp, supplier)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
          quantity = quantity + VALUES(quantity),
          purchase_price = VALUES(purchase_price),
          mrp = VALUES(mrp),
          expiry_date = VALUES(expiry_date),
          supplier = VALUES(supplier)`,
      [
        medicineId,
        batchNumber,
        expiryDate,
        Number(quantity),
        Number(purchasePrice || 0),
        Number(mrp || 0),
        supplier || 'Apex Pharma Labs'
      ]
    );

    await connection.commit();
    res.status(201).json({ success: true, message: `Batch ${batchNumber} inwarded successfully` });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 5. Retailer Order Placement
app.post('/api/orders', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { retailerName, retailerContact, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one line item' });
    }

    let calculatedTotal = 0;
    items.forEach(item => {
      calculatedTotal += Number(item.quantity) * Number(item.unitPrice);
    });

    await connection.beginTransaction();

    const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
    const [orderRes] = await connection.query(
      'INSERT INTO orders (order_number, retailer_name, retailer_contact, total_amount, status) VALUES (?, ?, ?, ?, ?)',
      [orderNumber, retailerName || 'General Chemist', retailerContact || '+91 98000 00000', calculatedTotal, 'PLACED']
    );

    const orderId = orderRes.insertId;

    for (const item of items) {
      await connection.query(
        'INSERT INTO order_items (order_id, medicine_id, medicine_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
        [orderId, item.medicineId || null, item.name, Number(item.quantity), Number(item.unitPrice)]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, orderId, orderNumber, totalAmount: calculatedTotal, status: 'PLACED' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 6. Order State Machine Transition with ACID FEFO Stock Deduction
app.patch('/api/orders/:id/status', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    const validStatuses = ['PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed values: ${validStatuses.join(', ')}` });
    }

    await connection.beginTransaction();

    // Lock and inspect current order state
    const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }

    const currentOrder = orders[0];

    // State Machine Validation
    const stateProgression = {
      'PLACED': ['CONFIRMED'],
      'CONFIRMED': ['DISPATCHED'],
      'DISPATCHED': ['DELIVERED'],
      'DELIVERED': []
    };

    if (currentOrder.status !== status && !stateProgression[currentOrder.status].includes(status)) {
      await connection.rollback();
      return res.status(400).json({
        error: `Illegal state transition from ${currentOrder.status} to ${status}`
      });
    }

    // Execute First-Expired, First-Out (FEFO) Stock Deduction on DELIVERED
    if (status === 'DELIVERED' && currentOrder.status !== 'DELIVERED') {
      const [items] = await connection.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

      for (const item of items) {
        let remainingDeduction = Number(item.quantity);

        // Lock eligible active batches sorted by earliest expiry date (FEFO)
        const [batches] = await connection.query(
          `SELECT b.id, b.batch_number, b.quantity, b.expiry_date 
           FROM batches b
           JOIN medicines m ON b.medicine_id = m.id
           WHERE (m.name = ? OR m.id = ?) 
             AND b.expiry_date >= CURDATE() 
             AND b.quantity > 0
           ORDER BY b.expiry_date ASC 
           FOR UPDATE`,
          [item.medicine_name, item.medicine_id]
        );

        for (const batch of batches) {
          if (remainingDeduction <= 0) break;

          if (batch.quantity >= remainingDeduction) {
            await connection.query('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [remainingDeduction, batch.id]);
            remainingDeduction = 0;
          } else {
            await connection.query('UPDATE batches SET quantity = 0 WHERE id = ?', [batch.id]);
            remainingDeduction -= batch.quantity;
          }
        }

        // Throw error and trigger ACID rollback if stock is insufficient
        if (remainingDeduction > 0) {
          throw new Error(`Insufficient non-expired inventory for ${item.medicine_name}. Shortfall: ${remainingDeduction} units.`);
        }
      }
    }

    await connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    await connection.commit();

    res.status(200).json({ success: true, message: `Order transitioned to ${status}` });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 7. Fetch All Orders
app.get('/api/orders', async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    const [items] = await pool.query('SELECT * FROM order_items');

    const result = orders.map(order => ({
      id: order.id,
      orderNumber: order.order_number,
      retailerName: order.retailer_name,
      retailerContact: order.retailer_contact,
      totalAmount: Number(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
      items: items
        .filter(it => it.order_id === order.id)
        .map(it => ({
          medicineName: it.medicine_name,
          quantity: it.quantity,
          unitPrice: Number(it.unit_price)
        }))
    }));

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`PharmaStock API active on http://localhost:${PORT}`);
});