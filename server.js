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

const costCodeMap = {
  "1": "F",
  "2": "A",
  "3": "N",
  "4": "C",
  "5": "Y",
  "6": "P",
  "7": "O",
  "8": "I",
  "9": "M",
  "0": "D"
};

function generateCostCode(cost) {
  const roundedCost = Math.round(Number(cost || 0)).toString();

  return roundedCost
    .split("")
    .map((digit) => costCodeMap[digit] || "")
    .join("");
}

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


app.get("/variants", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        v.id AS variant_id,
        v.product_id,
        v.size,
        v.sku,
        COALESCE(v.price, p.price) AS price,
        COALESCE(v.cost, p.cost, 0) AS cost,
        COALESCE(v.cost_code, p.cost_code) AS cost_code,
        v.stock,
        p.name,
        p.category
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      ORDER BY p.name ASC, v.id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/variant-qr/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.query(
      `
      SELECT
        v.id AS variant_id,
        v.product_id,
        v.size,
        v.sku,
        COALESCE(v.price, p.price) AS price,
        COALESCE(v.cost_code, p.cost_code) AS cost_code,
        v.stock,
        p.name,
        p.category
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Variant not found" });
    }

    const qrData = `variant:${id}`;

    QRCode.toDataURL(qrData, (err, qrImage) => {
      if (err) {
        return res.json({ error: err.message });
      }

      res.json({
        variant: result.rows[0],
        qr: qrImage
      });
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/add-variant-stock/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { qty } = req.body;

    const result = await db.query(
      `
      UPDATE product_variants
      SET stock = stock + $1
      WHERE id = $2
      RETURNING *
      `,
      [Number(qty), id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Variant not found" });
    }

    res.json({
      message: "Variant stock updated",
      variant: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.put("/update-variant/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { size, sku, price, cost, stock } = req.body;

    const costCode = generateCostCode(cost);

    const result = await db.query(
      `
      UPDATE product_variants
      SET size = $1,
          sku = $2,
          price = $3,
          cost = $4,
          cost_code = $5,
          stock = $6
      WHERE id = $7
      RETURNING *
      `,
      [size, sku || null, price || null, cost || 0, costCode, stock || 0, id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Variant not found" });
    }

    res.json({
      message: "Variant updated",
      variant: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/variant/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.query(
      `
      SELECT
        v.id AS variant_id,
        v.product_id,
        v.size,
        v.sku,
        COALESCE(v.price, p.price) AS price,
        COALESCE(v.cost, p.cost, 0) AS cost,
        COALESCE(v.cost_code, p.cost_code) AS cost_code,
        v.stock,
        p.name,
        p.category
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Variant not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/product/:id/variants", async (req, res) => {
  try {
    const productId = req.params.id;

    const result = await db.query(
      `
      SELECT *
      FROM product_variants
      WHERE product_id = $1
      ORDER BY id ASC
      `,
      [productId]
    );

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/add-variant", async (req, res) => {
  try {
    const { product_id, size, sku, price, cost, stock } = req.body;

    const costCode = generateCostCode(cost);

    const result = await db.query(
      `
      INSERT INTO product_variants
      (product_id, size, sku, price, cost, cost_code, stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (product_id, size)
      DO UPDATE SET
        sku = EXCLUDED.sku,
        price = EXCLUDED.price,
        cost = EXCLUDED.cost,
        cost_code = EXCLUDED.cost_code,
        stock = EXCLUDED.stock
      RETURNING *
      `,
      [
        product_id,
        size,
        sku || null,
        price || null,
        cost || 0,
        costCode,
        Number(stock || 0)
      ]
    );

    res.json({
      message: "Variant saved",
      variant: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/product-qr/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    const qrData = `product:${id}`;

    QRCode.toDataURL(qrData, (err, qrImage) => {
      if (err) {
        return res.json({ error: err.message });
      }

      res.json({
        product: result.rows[0],
        qr: qrImage
      });
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/add-stock/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { qty } = req.body;

    const result = await db.query(
      `
      UPDATE products
      SET stock = stock + $1
      WHERE id = $2
      RETURNING *
      `,
      [Number(qty), id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    res.json({
      message: "Stock updated",
      product: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.put("/update-product/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { name, category, price, stock, cost } = req.body;

    const costCode = generateCostCode(cost);

    const result = await db.query(
      `
      UPDATE products
      SET name = $1,
          category = $2,
          price = $3,
          stock = $4,
          cost = $5,
          cost_code = $6
      WHERE id = $7
      RETURNING *
      `,
      [name, category, price, stock, cost || 0, costCode, id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    res.json({
      message: "Product updated",
      product: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/return-bill-item", async (req, res) => {
  const client = await db.connect();

  try {
    const { billId, billItemId, qty, override } = req.body;

    const blockedItems = ["white dress", "cut pieces"];

    await client.query("BEGIN");

    const itemResult = await client.query(
      `
      SELECT 
        bi.*,
        b.return_deadline
      FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id
      WHERE bi.id = $1 AND bi.bill_id = $2
      `,
      [billItemId, billId]
    );

    if (itemResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ error: "Bill item not found" });
    }

    const item = itemResult.rows[0];

    if (!override) {
      const expired =
        item.return_deadline &&
        new Date(item.return_deadline) < new Date();

      if (expired) {
        await client.query("ROLLBACK");
        return res.json({ error: "Return period expired" });
      }

      if (blockedItems.includes(item.product_name.toLowerCase())) {
        await client.query("ROLLBACK");
        return res.json({ error: "Item not returnable" });
      }
    }

    const returnQty = Number(qty || 1);
    const itemQty = Number(item.qty || 1);
    const returnedQty = Number(item.returned_qty || 0);
    const remainingQty = itemQty - returnedQty;

    if (returnQty <= 0 || returnQty > remainingQty) {
      await client.query("ROLLBACK");
      return res.json({ error: "Invalid return quantity" });
    }

    if (item.variant_id) {
  await client.query(
    "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
    [returnQty, item.variant_id]
  );
} else if (item.product_id) {
  await client.query(
    "UPDATE products SET stock = stock + $1 WHERE id = $2",
    [returnQty, item.product_id]
  );

} else {
  await client.query(
    "UPDATE products SET stock = stock + $1 WHERE name = $2",
    [returnQty, item.product_name]
  );
}

    await client.query(
      "UPDATE bill_items SET returned_qty = returned_qty + $1 WHERE id = $2",
      [returnQty, billItemId]
    );

    await client.query(
      `
      INSERT INTO returns
(bill_id, bill_item_id, product_id, variant_id, size, product_name, price, qty, override_used)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
  billId,
  billItemId,
  item.product_id,
  item.variant_id || null,
  item.size || null,
  item.product_name,
  item.price,
  returnQty,
  override || false
]
    );

    await client.query("COMMIT");

    res.json({ message: "Item returned successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/products", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        p.*,
        COALESCE(SUM(v.stock), 0) AS variant_stock,
        COUNT(v.id) AS variant_count,
        CASE
          WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(v.stock), 0)
          ELSE p.stock
        END AS display_stock
      FROM products p
      LEFT JOIN product_variants v ON v.product_id = p.id
      GROUP BY p.id
      ORDER BY p.id DESC
    `);

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

app.get("/bill/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const billResult = await db.query(
      "SELECT * FROM bills WHERE id = $1",
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.json({ error: "Bill not found" });
    }

    const itemsResult = await db.query(
      "SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id ASC",
      [id]
    );

    res.json({
      bill: billResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    res.json({ error: err.message });
  }
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

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await db.query(
      "SELECT * FROM users WHERE username = $1 AND password = $2",
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Invalid login" });
    }

    res.json({
      message: "Login success",
      user: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/add-product", async (req, res) => {
  try {
    const { name, category, price, stock, cost } = req.body;

    const costCode = generateCostCode(cost);

    const result = await db.query(
      `
      INSERT INTO products (name, category, price, stock, cost, cost_code)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [name, category, price, stock, cost || 0, costCode]
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
        costCode,
        qr: qrImage
      });
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/reduce-stock/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const check = await db.query(
      "SELECT stock FROM products WHERE id = $1",
      [id]
    );

    if (check.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    const stock = check.rows[0].stock;

    if (stock <= 0) {
      return res.json({ error: "Out of stock" });
    }

    await db.query(
      "UPDATE products SET stock = stock - 1 WHERE id = $1",
      [id]
    );

    res.json({ message: "Stock reduced" });

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/sales-summary", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM bills) AS "totalBills",

        (
          COALESCE((SELECT SUM(total) FROM bills), 0)
          -
          COALESCE((SELECT SUM(price * qty) FROM returns), 0)
        ) AS "totalRevenue",

        COALESCE((SELECT SUM(price * qty) FROM returns), 0) AS "totalReturns",

        (
          COALESCE((
            SELECT SUM(
              (price - COALESCE(cost, 0)) *
              GREATEST(COALESCE(qty, 1) - COALESCE(returned_qty, 0), 0)
            )
            FROM bill_items
          ), 0)
          -
          COALESCE((SELECT SUM(discount) FROM bills), 0)
        ) AS "totalProfit"
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/save-bill", async (req, res) => {
  try {
    const {
      items,
      subtotal,
      discount,
      total,
      customerName,
      customerPhone,
      paymentMethod
    } = req.body;

    const billResult = await db.query(
      `
      INSERT INTO bills
      (subtotal, discount, total, customer_name, customer_phone, payment_method)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [
        subtotal,
        discount,
        total,
        customerName || null,
        customerPhone || null,
        paymentMethod || "Cash"
      ]
    );

    const billId = billResult.rows[0].id;

    for (const item of items) {
      await db.query(
        `
        INSERT INTO bill_items
        (bill_id, product_id, product_name, price, qty)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [billId, item.id, item.name, item.price, item.qty]
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

app.post("/return-item", async (req, res) => {
  try {
    const { billId, productName, override } = req.body;

    const blockedItems = ["white dress", "cut pieces"];

    if (!override) {
      const billCheck = await db.query(
        "SELECT * FROM bills WHERE id = $1 AND return_deadline >= CURRENT_DATE",
        [billId]
      );

      if (billCheck.rows.length === 0) {
        return res.json({ message: "Return period expired" });
      }

      if (blockedItems.includes(productName.toLowerCase())) {
        return res.json({ message: "Item not returnable" });
      }
    }

    const productResult = await db.query(
      "SELECT price FROM products WHERE name = $1",
      [productName]
    );

    if (productResult.rows.length === 0) {
      return res.json({ message: "Product not found" });
    }

    const price = productResult.rows[0].price;

    await db.query(
      "UPDATE products SET stock = stock + 1 WHERE name = $1",
      [productName]
    );

    await db.query(
      `
      INSERT INTO returns
      (bill_id, product_name, price, override_used)
      VALUES ($1, $2, $3, $4)
      `,
      [billId, productName, price, override || false]
    );

    res.json({ message: "Return processed successfully" });
  } catch (err) {
    res.json({ error: err.message });
  }
});


app.get("/today-sales", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) AS "billsToday",
        COALESCE(SUM(total), 0) AS "revenueToday"
      FROM bills
      WHERE DATE(created_at) = CURRENT_DATE
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/sales-today", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COALESCE((
          SELECT SUM(total)
          FROM bills
          WHERE DATE(created_at) = CURRENT_DATE
        ), 0)
        -
        COALESCE((
          SELECT SUM(price * qty)
          FROM returns
          WHERE DATE(created_at) = CURRENT_DATE
        ), 0) AS "totalSales",

        (
          SELECT COUNT(*)
          FROM bills
          WHERE DATE(created_at) = CURRENT_DATE
        ) AS "billCount",

        COALESCE((
          SELECT SUM(price * qty)
          FROM returns
          WHERE DATE(created_at) = CURRENT_DATE
        ), 0) AS "returnedAmount"
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/sales-month", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COALESCE((
          SELECT SUM(total)
          FROM bills
          WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        ), 0)
        -
        COALESCE((
          SELECT SUM(price * qty)
          FROM returns
          WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        ), 0) AS "totalSales",

        (
          SELECT COUNT(*)
          FROM bills
          WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        ) AS "billCount",

        COALESCE((
          SELECT SUM(price * qty)
          FROM returns
          WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        ), 0) AS "returnedAmount"
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/top-products", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        bi.product_name,
        SUM(bi.qty) - COALESCE(SUM(bi.returned_qty), 0) AS "totalSold"
      FROM bill_items bi
      GROUP BY bi.product_name
      ORDER BY "totalSold" DESC
      LIMIT 5
    `);

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/sales-chart", async (req, res) => {
  try {
    const result = await db.query(`
      WITH sales AS (
        SELECT DATE(created_at) AS date, SUM(total) AS sales_total
        FROM bills
        GROUP BY DATE(created_at)
      ),
      refunds AS (
        SELECT DATE(created_at) AS date, SUM(price * qty) AS return_total
        FROM returns
        GROUP BY DATE(created_at)
      )
      SELECT
        COALESCE(s.date, r.date) AS date,
        COALESCE(s.sales_total, 0) - COALESCE(r.return_total, 0) AS total
      FROM sales s
      FULL OUTER JOIN refunds r ON s.date = r.date
      ORDER BY date ASC
    `);

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/low-stock", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM products WHERE stock <= 5"
    );

    res.json(result.rows);

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/checkout", async (req, res) => {
  const client = await db.connect();

  try {
    const {
      items,
      subtotal,
      discount,
      total,
      customerName,
      customerPhone,
      paymentMethod,
      offlineRef
    } = req.body;

    await client.query("BEGIN");

    if (offlineRef) {
      const existingBill = await client.query(
        "SELECT id FROM bills WHERE offline_ref = $1",
        [offlineRef]
      );

      if (existingBill.rows.length > 0) {
        await client.query("COMMIT");

        return res.json({
          message: "Bill already synced",
          billId: existingBill.rows[0].id,
          alreadySynced: true
        });
      }
    }

    const itemCostMap = {};

    for (const item of items) {
      const qty = Number(item.qty || 1);

      if (item.variant_id) {
        const stockResult = await client.query(
          "SELECT stock, cost FROM product_variants WHERE id = $1 FOR UPDATE",
          [item.variant_id]
        );

        if (stockResult.rows.length === 0) {
          throw new Error(item.name + " size " + item.size + " not found");
        }

        const stock = Number(stockResult.rows[0].stock);

        if (stock < qty) {
          throw new Error(
            item.name + " size " + item.size + " only has " + stock + " left"
          );
        }

        await client.query(
          "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
          [qty, item.variant_id]
        );

        itemCostMap[item.variant_id] = Number(stockResult.rows[0].cost || 0);
      } else {
        const stockResult = await client.query(
          "SELECT stock, cost FROM products WHERE id = $1 FOR UPDATE",
          [item.id]
        );

        if (stockResult.rows.length === 0) {
          throw new Error(item.name + " not found");
        }

        const stock = Number(stockResult.rows[0].stock);

        if (stock < qty) {
          throw new Error(item.name + " only has " + stock + " left");
        }

        await client.query(
          "UPDATE products SET stock = stock - $1 WHERE id = $2",
          [qty, item.id]
        );

        itemCostMap[item.id] = Number(stockResult.rows[0].cost || 0);
      }
    }

    const billResult = await client.query(
      `
      INSERT INTO bills
      (subtotal, discount, total, customer_name, customer_phone, payment_method, offline_ref, return_deadline)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE + INTERVAL '7 days')
      RETURNING id
      `,
      [
        subtotal,
        discount,
        total,
        customerName || null,
        customerPhone || null,
        paymentMethod || "Cash",
        offlineRef || null
      ]
    );

    const billId = billResult.rows[0].id;

    for (const item of items) {
      const costKey = item.variant_id || item.id;

      await client.query(
        `
        INSERT INTO bill_items
        (bill_id, product_id, variant_id, size, product_name, price, qty, cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          billId,
          item.product_id || item.id,
          item.variant_id || null,
          item.size || null,
          item.name,
          item.price,
          Number(item.qty || 1),
          itemCostMap[costKey] || 0
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      message: "Checkout completed",
      billId
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.json({ error: err.message });
  } finally {
    client.release();
  }
});



const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});