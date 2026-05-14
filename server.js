const QRCode = require("qrcode");
const { Pool } = require("pg");
const express = require("express");
const cors = require("cors");

const app = express();
require("dotenv").config();


const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

db.connect()
  .then(() => console.log("Supabase database connected"))
  .catch((err) => console.log("DB connection failed:", err));

//const { load, save } = require("../pos-mobile/localStore");

app.use(cors({
  origin: "*"
}));

app.use(express.json());

/*app.post("/offline-bill", (req, res) => {
  let data = load();

  const bill = {
    id: Date.now(),
    items: req.body.items,
    total: req.body.total,
    synced: false,
    created_at: new Date()
  };

  data.push(bill);
  save(data);

  res.json({
    message: "Saved offline",
    bill
  });
});*/

/*app.post("/sync-bills", (req, res) => {
  let data = load();

  let unsynced = data.filter(b => !b.synced);

  unsynced.forEach(bill => {
    db.query(
      "INSERT INTO bills (total, created_at) VALUES (?, ?)",
      [bill.total, bill.created_at]
    );

    bill.synced = true;
  });

  save(data);

  res.json({
    message: "Synced successfully",
    count: unsynced.length
  });
});*/



// test route
app.get("/", (req, res) => {
  res.send("POS Cloud Running");
});


app.get("/products", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products");
    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/product/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/bill/:id", (req, res) => {
  const id = req.params.id;

  db.query("SELECT * FROM bills WHERE id = ?", [id], (err, bill) => {
    if (err) return res.json({ error: err });

    db.query("SELECT * FROM bill_items WHERE bill_id = ?", [id], (err2, items) => {
      if (err2) return res.json({ error: err2 });

      res.json({
        bill: bill[0],
        items: items
      });
    });
  });
});

app.post("/create-bill", (req, res) => {
  const { items, total } = req.body;
  const today = new Date();
  const returnDate = new Date();
  returnDate.setDate(today.getDate() + 7);

  db.query(
  "INSERT INTO bills (total, return_deadline) VALUES (?, ?)",
  [total, returnDate],
  (err, result) => {
    if (err) return res.json({ error: err });

    const billId = result.insertId;

    items.forEach(item => {
      db.query(
        "INSERT INTO bill_items (bill_id, product_name, price) VALUES (?, ?, ?)",
        [billId, item.name, item.price]
      );
    });

    res.json({
      message: "Bill saved",
      billId: billId
    });
  });
});


app.post("/add-product", async (req, res) => {
  try {
    const { name, category, price, stock } = req.body;

    const result = await db.query(
      `
      INSERT INTO products (name, category, price, stock)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [name, category, price, stock]
    );

    const productId = result.rows[0].id;

    const qrData = `product:${productId}`;

    QRCode.toDataURL(qrData, (err, qrImage) => {
      if (err) {
        return res.json({ error: err.message });
      }

      res.json({
        message: "Product saved",
        productId,
        qr: qrImage
      });
    });

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/reduce-stock/:id", (req, res) => {
  const id = req.params.id;

  // Step 1: check stock first
  const checkSql = "SELECT stock FROM products WHERE id = ?";

  db.query(checkSql, [id], (err, result) => {
    if (err) return res.json({ error: err });

    if (result.length === 0) {
      return res.json({ error: "Product not found" });
    }

    const stock = result[0].stock;

    // ❌ BLOCK IF NO STOCK
    if (stock <= 0) {
      return res.json({ error: "Out of stock" });
    }

    // Step 2: reduce stock
    const updateSql = `
      UPDATE products 
      SET stock = stock - 1 
      WHERE id = ?
    `;

    db.query(updateSql, [id], (err2) => {
      if (err2) return res.json({ error: err2 });

      res.json({ message: "Stock reduced" });
    });
  });
});



app.get("/sales-summary", (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as totalBills,
      SUM(total) as totalRevenue
    FROM bills
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result[0]);
  });
});

app.get("/bills", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM bills ORDER BY id DESC"
    );

    res.json(result.rows);

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/save-bill", async (req, res) => {
  try {
    const { items, total } = req.body;

    const billResult = await db.query(
      "INSERT INTO bills (total) VALUES ($1) RETURNING id",
      [total]
    );

    const billId = billResult.rows[0].id;

    for (const item of items) {
      await db.query(
        `
        INSERT INTO bill_items
        (bill_id, product_name, price)
        VALUES ($1, $2, $3)
        `,
        [billId, item.name, item.price]
      );
    }

    res.json({
      message: "Bill saved",
      billId
    });

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/return-item", (req, res) => {
  const { billId, productName, override } = req.body;

  const blockedItems = ["white dress", "cut pieces"];

  // 🔍 Check rules (only if NOT override)
  const checkRules = (callback) => {
    if (override === true) return callback(true, "Override");

    db.query(
      "SELECT * FROM bills WHERE id = ? AND return_deadline >= CURDATE()",
      [billId],
      (err, result) => {
        if (err) return res.json({ error: err });

        if (result.length === 0) {
          return res.json({ message: "Return period expired" });
        }

        if (blockedItems.includes(productName.toLowerCase())) {
          return res.json({ message: "Item not returnable" });
        }

        callback(true, "Normal");
      }
    );
  };

  // 🚀 Main process
  checkRules(() => {

    // 1. Get product price
    db.query(
      "SELECT price FROM products WHERE name = ?",
      [productName],
      (err, result) => {
        if (err || result.length === 0) {
          return res.json({ message: "Product not found" });
        }

        const price = result[0].price;

        // 2. Increase stock
        db.query(
          "UPDATE products SET stock = stock + 1 WHERE name = ?",
          [productName]
        );

        // 3. Save return record
        db.query(
          "INSERT INTO returns (bill_id, product_name, price, override_used) VALUES (?, ?, ?, ?)",
          [billId, productName, price, override]
        );

        res.json({ message: "Return processed successfully" });
      }
    );

  });
});


app.get("/today-sales", (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as billsToday,
      SUM(total) as revenueToday
    FROM bills
    WHERE DATE(created_at) = CURDATE()
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result[0]);
  });
});

app.get("/sales-today", (req, res) => {
  const sql = `
    SELECT 
      SUM(total) AS totalSales,
      COUNT(*) AS billCount
    FROM bills
    WHERE DATE(created_at) = CURDATE()
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result[0]);
  });
});

app.get("/sales-month", (req, res) => {
  const sql = `
    SELECT 
      SUM(total) AS totalSales,
      COUNT(*) AS billCount
    FROM bills
    WHERE MONTH(created_at) = MONTH(CURDATE())
      AND YEAR(created_at) = YEAR(CURDATE())
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result[0]);
  });
});

app.get("/top-products", (req, res) => {
  const sql = `
    SELECT product_name, COUNT(*) AS totalSold
    FROM bill_items
    GROUP BY product_name
    ORDER BY totalSold DESC
    LIMIT 5
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result);
  });
});

app.get("/sales-chart", (req, res) => {
  const sql = `
    SELECT DATE(created_at) as date, SUM(total) as total
    FROM bills
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result);
  });
});

app.get("/low-stock", (req, res) => {
  const sql = `
    SELECT * FROM products
    WHERE stock <= 5
  `;

  db.query(sql, (err, result) => {
    if (err) return res.json({ error: err });

    res.json(result);
  });
});



const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});