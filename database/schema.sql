-- ============================================================================
-- PharmaStock Core Relational Database Schema & Seeder
-- ============================================================================

CREATE DATABASE IF NOT EXISTS pharmastock;
USE pharmastock;

-- Disable foreign key checks for clean tear-down during initialization
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS batches;
DROP TABLE IF EXISTS medicines;
SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
-- 1. Master Medicines Table
-- ----------------------------------------------------------------------------
CREATE TABLE medicines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    composition VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    average_daily_demand INT NOT NULL DEFAULT 15,
    lead_time_days INT NOT NULL DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 2. Batches Table (Hierarchical Multi-Batch Inventory)
-- ----------------------------------------------------------------------------
CREATE TABLE batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medicine_id INT NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    expiry_date DATE NOT NULL,
    quantity INT NOT NULL CHECK (quantity >= 0),
    purchase_price DECIMAL(10, 2) NOT NULL,
    mrp DECIMAL(10, 2) NOT NULL,
    supplier VARCHAR(255) NOT NULL DEFAULT 'Apex Pharma Labs',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
    UNIQUE KEY unique_batch_per_medicine (medicine_id, batch_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 3. Orders Master Table
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    retailer_name VARCHAR(255) NOT NULL,
    retailer_contact VARCHAR(50) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status ENUM('PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED') NOT NULL DEFAULT 'PLACED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 4. Order Items Table (Line-Item Breakdown)
-- ----------------------------------------------------------------------------
CREATE TABLE order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    medicine_id INT,
    medicine_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================================
-- Pharmaceutical Dataset Seeding (8 Core Molecules + Multi-Horizon Batches)
-- ============================================================================

INSERT INTO medicines (id, sku, name, composition, category, average_daily_demand, lead_time_days) VALUES
(1, 'SKU-PCM-500', 'Paracetamol 500mg', 'Paracetamol IP', 'Analgesic', 35, 3),
(2, 'SKU-AMX-500', 'Amoxicillin 500mg', 'Amoxicillin Trihydrate', 'Antibiotic', 20, 4),
(3, 'SKU-AZM-500', 'Azithromycin 500mg', 'Azithromycin USP', 'Antibiotic', 15, 3),
(4, 'SKU-MET-500', 'Metformin 500mg', 'Metformin Hydrochloride', 'Antidiabetic', 45, 5),
(5, 'SKU-CET-010', 'Cetirizine 10mg', 'Cetirizine Hydrochloride', 'Antihistamine', 18, 2),
(6, 'SKU-PAN-040', 'Pantoprazole 40mg', 'Pantoprazole Sodium IP', 'Antacid / PPI', 28, 3),
(7, 'SKU-ATV-010', 'Atorvastatin 10mg', 'Atorvastatin Calcium', 'Cardiovascular', 12, 4),
(8, 'SKU-TLM-040', 'Telmisartan 40mg', 'Telmisartan IP', 'Antihypertensive', 22, 3);

-- Batch seeding spanning all operational expiry horizons:
-- 1. Expired: DATE_SUB(CURDATE(), INTERVAL X DAY)
-- 2. Critical Risk (<= 30 Days): DATE_ADD(CURDATE(), INTERVAL X DAY)
-- 3. Medium Risk (31-60 Days): DATE_ADD(CURDATE(), INTERVAL X DAY)
-- 4. Watchlist (61-90 Days): DATE_ADD(CURDATE(), INTERVAL X DAY)
-- 5. Healthy Stock (> 180 Days): DATE_ADD(CURDATE(), INTERVAL X DAY)

INSERT INTO batches (medicine_id, batch_number, expiry_date, quantity, purchase_price, mrp, supplier) VALUES
-- Paracetamol 500mg (ID: 1)
(1, 'PCM-EXP-01', DATE_SUB(CURDATE(), INTERVAL 15 DAY), 80, 10.50, 18.00, 'Cipla Labs'),
(1, 'PCM-CRT-02', DATE_ADD(CURDATE(), INTERVAL 12 DAY), 250, 11.00, 18.00, 'Cipla Labs'),
(1, 'PCM-MED-03', DATE_ADD(CURDATE(), INTERVAL 45 DAY), 400, 11.00, 18.00, 'Cipla Labs'),
(1, 'PCM-HLT-04', DATE_ADD(CURDATE(), INTERVAL 240 DAY), 1200, 10.00, 18.00, 'Cipla Labs'),

-- Amoxicillin 500mg (ID: 2)
(2, 'AMX-CRT-01', DATE_ADD(CURDATE(), INTERVAL 20 DAY), 60, 48.00, 75.00, 'Sun Pharma'),
(2, 'AMX-MED-02', DATE_ADD(CURDATE(), INTERVAL 50 DAY), 180, 48.00, 75.00, 'Sun Pharma'),
(2, 'AMX-HLT-03', DATE_ADD(CURDATE(), INTERVAL 300 DAY), 500, 45.00, 75.00, 'Sun Pharma'),

-- Azithromycin 500mg (ID: 3)
(3, 'AZM-EXP-01', DATE_SUB(CURDATE(), INTERVAL 30 DAY), 40, 68.00, 115.00, 'Zydus Healthcare'),
(3, 'AZM-WAT-02', DATE_ADD(CURDATE(), INTERVAL 75 DAY), 300, 70.00, 115.00, 'Zydus Healthcare'),
(3, 'AZM-HLT-03', DATE_ADD(CURDATE(), INTERVAL 360 DAY), 750, 65.00, 115.00, 'Zydus Healthcare'),

-- Metformin 500mg (ID: 4)
(4, 'MET-CRT-01', DATE_ADD(CURDATE(), INTERVAL 10 DAY), 150, 14.00, 26.00, 'USV Private Limited'),
(4, 'MET-WAT-02', DATE_ADD(CURDATE(), INTERVAL 82 DAY), 600, 14.00, 26.00, 'USV Private Limited'),
(4, 'MET-HLT-03', DATE_ADD(CURDATE(), INTERVAL 400 DAY), 1500, 13.20, 26.00, 'USV Private Limited'),

-- Cetirizine 10mg (ID: 5)
(5, 'CET-EXP-01', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 100, 16.00, 32.00, 'Dr. Reddys Labs'),
(5, 'CET-MED-02', DATE_ADD(CURDATE(), INTERVAL 38 DAY), 350, 17.50, 32.00, 'Dr. Reddys Labs'),
(5, 'CET-HLT-03', DATE_ADD(CURDATE(), INTERVAL 210 DAY), 900, 16.00, 32.00, 'Dr. Reddys Labs'),

-- Pantoprazole 40mg (ID: 6)
(6, 'PAN-CRT-01', DATE_ADD(CURDATE(), INTERVAL 25 DAY), 120, 52.00, 88.00, 'Alkem Labs'),
(6, 'PAN-WAT-02', DATE_ADD(CURDATE(), INTERVAL 68 DAY), 450, 52.00, 88.00, 'Alkem Labs'),
(6, 'PAN-HLT-03', DATE_ADD(CURDATE(), INTERVAL 270 DAY), 800, 50.00, 88.00, 'Alkem Labs'),

-- Atorvastatin 10mg (ID: 7)
(7, 'ATV-EXP-01', DATE_SUB(CURDATE(), INTERVAL 45 DAY), 30, 58.00, 95.00, 'Lupin Pharma'),
(7, 'ATV-MED-02', DATE_ADD(CURDATE(), INTERVAL 55 DAY), 200, 60.00, 95.00, 'Lupin Pharma'),
(7, 'ATV-HLT-03', DATE_ADD(CURDATE(), INTERVAL 330 DAY), 600, 57.00, 95.00, 'Lupin Pharma'),

-- Telmisartan 40mg (ID: 8)
(8, 'TLM-CRT-01', DATE_ADD(CURDATE(), INTERVAL 18 DAY), 90, 42.00, 68.00, 'Torrent Pharma'),
(8, 'TLM-WAT-02', DATE_ADD(CURDATE(), INTERVAL 88 DAY), 400, 42.00, 68.00, 'Torrent Pharma'),
(8, 'TLM-HLT-03', DATE_ADD(CURDATE(), INTERVAL 365 DAY), 1100, 39.50, 68.00, 'Torrent Pharma');

-- Seed Sample Orders
INSERT INTO orders (id, order_number, retailer_name, retailer_contact, total_amount, status) VALUES
(1, 'ORD-2026-1001', 'Sanjeevani Chemist', '+91 98231 44510', 3600.00, 'PLACED'),
(2, 'ORD-2026-1002', 'Apollo Care Pharmacy', '+91 94220 11982', 5750.00, 'CONFIRMED'),
(3, 'ORD-2026-1003', 'MedPlus Health Mart', '+91 98112 33490', 2700.00, 'DELIVERED');

-- Seed Order Items
INSERT INTO order_items (order_id, medicine_id, medicine_name, quantity, unit_price) VALUES
(1, 1, 'Paracetamol 500mg', 200, 18.00),
(2, 3, 'Azithromycin 500mg', 50, 115.00),
(3, 2, 'Amoxicillin 500mg', 20, 75.00),
(3, 5, 'Cetirizine 10mg', 37, 32.00);