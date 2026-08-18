## 💊 PharmaStock

> **Operating System & Inventory Engine for Pharmaceutical Stockists and B2B Distributors**

PharmaStock modernizes traditional pharmaceutical distribution by replacing error-prone manual ledgers with an automated First-Expired, First-Out (FEFO) fulfillment engine, real-time working capital risk auditing, and automated data synchronization for business intelligence.

````
````
## 🏗️ System Architecture

```text
Browser Frontend (:3000)
       │ HTTP / REST API
       ▼
Node.js + Express API (:4000)
       │ mysql2 (ACID Transactions & FEFO Engine)
       ▼
MySQL / XAMPP Database (:3306)
       │ PyMySQL Polling Worker
       ▼
Python ETL Pipeline (sync_excel.py) ──► pharmastock_live_data.xlsx ──► Power BI Dashboard
---
```
## 📂 Repository Structure

```
pharmastock/
├── database/
│   └── schema.sql             # Relational DDL & multi-batch seed data
├── backend/
│   ├── .env.example           # Environment template
│   ├── package.json           # Express, mysql2, cors
│   └── server.js              # REST API & transactional FEFO order engine
├── frontend/
│   └── index.html             # React 18 + Tailwind SPA (Command Center & Retailer Desk)
├── automation/
│   ├── .env.example           # Python environment config
│   ├── requirements.txt       # pandas, openpyxl, pymysql
│   └── sync_excel.py          # Auto-sync MySQL tables to Excel workbook
├── .gitignore
└── README.md

```

## ⚡ Key Features
```
* **Hierarchical Batch Tracking:** Discrete tracking for batch number, expiry date, purchase price, MRP, and supplier under each master medicine SKU.
* **FEFO Order Allocation:** When orders reach `DELIVERED`, stock is deducted sequentially from the earliest non-expired batch via atomic SQL transactions.
* **Expiry Risk Horizon Auditing:** Continuous classification into Expired ($<0\text{d}$), Critical ($\le 30\text{d}$), Medium ($31\text{--}60\text{d}$), Watchlist ($61\text{--}90\text{d}$), and Healthy stock.
* **Stock-Out Forecasting:** Dynamic calculation of Average Daily Demand (ADD) against supplier lead times to flag critical reorder SKUs.
* **Dual-View Web Interface:**
* **Stockist Command Center:** KPI metrics, risk buckets, inbound stock entry, and state-machine order dispatch.
* **Retailer Order Desk:** Real-time stock catalog and instant digital purchase order placement.


* **Automated BI Integration:** Python ETL script outputs `pharmastock_live_data.xlsx` for direct ingestion into Power BI star-schema models.

---

## 🛠️ Getting Started

### Prerequisites

* [Node.js (LTS)](https://nodejs.org/)
* [XAMPP](https://www.apachefriends.org/) (for MySQL)
* [Python 3.x](https://www.python.org/) (with PATH enabled)

---
```
### Step 1: Initialize the Database

1. Open the **XAMPP Control Panel** and start **MySQL**.
2. Open phpMyAdmin (`http://localhost/phpmyadmin`) or MySQL CLI.
3. Execute the SQL script located at `database/schema.sql`:

```powershell
mysql -u root -p < .\database\schema.sql

```

---

### Step 2: Start the Backend API

```powershell
cd D:\pharmastock\backend
Copy-Item .env.example .env
npm install
npm run dev

```

*API runs on `http://localhost:4000`. Test health at `http://localhost:4000/api/health`.*

---

### Step 3: Launch the Frontend

In a **second terminal window**:

```powershell
cd D:\pharmastock\frontend
npx serve . -l 3000

```

*Open `http://localhost:3000` in your web browser.*

---

### Step 4: Run the Live Excel Automation

In a **third terminal window**:

```powershell
cd D:\pharmastock\automation
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python sync_excel.py

```

*Outputs live inventory and sales tables to `automation/output/pharmastock_live_data.xlsx`.*

---

## 📊 Power BI Analytics & DAX Measures

Connect Power BI Desktop to `automation/output/pharmastock_live_data.xlsx`:

1. **Import Tables:** `Live_Inventory`, `Orders_Log`, `Sales_Fact`.
2. **Model Relationship:** Connect `Sales_Fact[medicine_id]` $\rightarrow$ `Live_Inventory[medicine_id]`.
3. **Core DAX Measures:**

```dax
Revenue = SUM(Sales_Fact[line_total])

```

```dax
Capital At Risk = 
CALCULATE(
    SUMX(Live_Inventory, Live_Inventory[available_quantity] * Live_Inventory[purchase_price]),
    Live_Inventory[expiry_bucket] IN {"EXPIRED", "CRITICAL_30", "MEDIUM_60"}
)

```

```dax
Units Sold = SUM(Sales_Fact[quantity])

```

---

## 🔌 API Endpoints Reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/metrics` | Aggregated KPI metrics and expiry risk totals |
| `GET` | `/api/inventory` | Multi-batch inventory with run-out projections |
| `POST` | `/api/inventory/batch` | Add or increment batch inventory |
| `POST` | `/api/orders` | Place a new retailer order |
| `PATCH` | `/api/orders/:id/status` | Advance lifecycle status (`PLACED` $\rightarrow$ `CONFIRMED` $\rightarrow$ `DISPATCHED` $\rightarrow$ `DELIVERED` with atomic FEFO deduction) |

---

## ⚠️ Disclaimer

This is a starter implementation designed for demonstration, learning, and portfolio showcases. It is **not production-ready** for regulated healthcare operations without implementing authentication, granular RBAC, audit logs, and compliance controls.

```

```
