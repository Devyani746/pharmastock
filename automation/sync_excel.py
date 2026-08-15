import os
import time
from pathlib import Path
import pandas as pd
import pymysql
from dotenv import load_dotenv

# Load environment variables if present
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 3306)),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "pharmastock"),
}

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "pharmastock_live_data.xlsx"


def get_db_connection():
    return pymysql.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        database=DB_CONFIG["database"],
        cursorclass=pymysql.cursors.DictCursor,
    )


def extract_and_sync():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        connection = get_db_connection()

        # 1. Live Inventory with computed risk buckets and valuation
        query_inventory = """
            SELECT 
                b.id AS batch_id,
                m.id AS medicine_id,
                m.sku,
                m.name AS medicine_name,
                m.category,
                m.composition,
                b.batch_number,
                b.expiry_date,
                b.quantity AS available_quantity,
                b.purchase_price,
                b.mrp,
                b.supplier,
                (b.quantity * b.purchase_price) AS total_valuation,
                CASE 
                    WHEN b.expiry_date < CURDATE() THEN 'EXPIRED'
                    WHEN b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'CRITICAL_30'
                    WHEN b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 'MEDIUM_60'
                    ELSE 'HEALTHY'
                END AS expiry_bucket
            FROM batches b
            JOIN medicines m ON b.medicine_id = m.id
            ORDER BY b.expiry_date ASC;
        """

        # 2. Orders Log
        query_orders = """
            SELECT 
                id AS order_id,
                order_number,
                retailer_name,
                retailer_contact,
                total_amount,
                status AS order_status,
                created_at AS order_date
            FROM orders
            ORDER BY created_at DESC;
        """

        # 3. Sales Fact (Order Line Items)
        query_sales = """
            SELECT 
                oi.id AS line_item_id,
                oi.order_id,
                o.order_number,
                oi.medicine_id,
                oi.medicine_name,
                oi.quantity,
                oi.unit_price,
                (oi.quantity * oi.unit_price) AS line_total,
                o.status AS order_status,
                o.created_at AS sale_date
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            ORDER BY o.created_at DESC;
        """

        df_inventory = pd.read_sql(query_inventory, connection)
        df_orders = pd.read_sql(query_orders, connection)
        df_sales = pd.read_sql(query_sales, connection)

        connection.close()

        # Atomic Excel write
        with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl", mode="w") as writer:
            df_inventory.to_excel(writer, sheet_name="Live_Inventory", index=False)
            df_orders.to_excel(writer, sheet_name="Orders_Log", index=False)
            df_sales.to_excel(writer, sheet_name="Sales_Fact", index=False)

        print(
            f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Live Sync Success -> {OUTPUT_FILE.name} "
            f"({len(df_inventory)} batches, {len(df_orders)} orders, {len(df_sales)} sales rows)"
        )

    except Exception as e:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Sync Error: {e}")


if __name__ == "__main__":
    print("Starting PharmaStock Excel Sync Engine (Polling every 30 seconds)...")
    while True:
        extract_and_sync()
        time.sleep(30)