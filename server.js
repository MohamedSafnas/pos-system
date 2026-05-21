const QRCode = require("qrcode");
const { Pool } = require("pg");
const express = require("express");
const cors = require("cors");

const app = express();
require("dotenv").config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

db.connect()
  .then(() => console.log("Supabase database connected"))
  .catch((err) => console.log("DB connection failed:", err));

//const { load, save } = require("../pos-mobile/localStore");

app.use(
  cors({
    origin: "*",
  }),
);

app.use(express.json());

const costCodeMap = {
  1: "F",
  2: "A",
  3: "N",
  4: "C",
  5: "Y",
  6: "P",
  7: "O",
  8: "I",
  9: "M",
  0: "D",
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


app.get("/product-sales", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        bi.product_id,
        bi.variant_id,
        bi.product_name,
        bi.size,
        SUM(bi.qty) AS "soldQty",
        SUM(COALESCE(bi.returned_qty, 0)) AS "returnedQty",
        SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)) AS "netQty",
        SUM(bi.price * bi.qty) AS "grossRevenue",
        SUM(bi.price * COALESCE(bi.returned_qty, 0)) AS "returnedAmount",
        SUM(
          bi.price * 
          GREATEST(COALESCE(bi.qty, 1) - COALESCE(bi.returned_qty, 0), 0)
        ) AS "netRevenue",
        SUM(
          (bi.price - COALESCE(bi.cost, 0)) *
          GREATEST(COALESCE(bi.qty, 1) - COALESCE(bi.returned_qty, 0), 0)
        ) AS "profit"
      FROM bill_items bi
      GROUP BY
        bi.product_id,
        bi.variant_id,
        bi.product_name,
        bi.size
      ORDER BY "netQty" DESC
    `);

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/cash-flow", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COALESCE((SELECT SUM(total) FROM bills), 0) AS "netSales",
        COALESCE((SELECT SUM(subtotal) FROM bills), 0) AS "grossSales",
        COALESCE((SELECT SUM(discount) FROM bills), 0) AS "manualDiscounts",
        COALESCE((SELECT SUM(point_discount) FROM bills), 0) AS "pointDiscounts",
        COALESCE((SELECT SUM(price * qty) FROM returns), 0) AS "returnsAmount",

        COALESCE((
          SELECT SUM(total)
          FROM bills
          WHERE payment_method = 'Cash'
        ), 0) AS "cashSales",

        COALESCE((
          SELECT SUM(total)
          FROM bills
          WHERE payment_method = 'Card'
        ), 0) AS "cardSales",

        COALESCE((
          SELECT SUM(total)
          FROM bills
          WHERE payment_method = 'Transfer'
        ), 0) AS "transferSales",

        COALESCE((
          SELECT SUM(
            (price - COALESCE(cost, 0)) *
            GREATEST(COALESCE(qty, 1) - COALESCE(returned_qty, 0), 0)
          )
          FROM bill_items
        ), 0)
        -
        COALESCE((SELECT SUM(discount) FROM bills), 0)
        -
        COALESCE((SELECT SUM(point_discount) FROM bills), 0)
        AS "profit"
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/customers", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        id,
        name,
        phone,
        points,
        total_spent,
        created_at
      FROM customers
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/customer/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;

    const result = await db.query("SELECT * FROM customers WHERE phone = $1", [
      phone,
    ]);

    if (result.rows.length === 0) {
      return res.json({ error: "Customer not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/category-options", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT gender), NULL) AS genders,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT category), NULL) AS categories,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT subcategory), NULL) AS subcategories
      FROM products
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.json({ error: err.message });
  }
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
      [id],
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
        qr: qrImage,
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
      [Number(qty), id],
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Variant not found" });
    }

    res.json({
      message: "Variant stock updated",
      variant: result.rows[0],
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.put("/update-variant/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { size, sku, price, cost, stock } = req.body;

    const sizeStock = Number(stock || 0);

    const variantCheck = await db.query(
      "SELECT product_id FROM product_variants WHERE id = $1",
      [id],
    );

    if (variantCheck.rows.length === 0) {
      return res.json({ error: "Variant not found" });
    }

    const productId = variantCheck.rows[0].product_id;

    const productResult = await db.query(
      "SELECT stock FROM products WHERE id = $1",
      [productId],
    );

    const totalProductStock = Number(productResult.rows[0].stock || 0);

    const usedResult = await db.query(
      `
      SELECT COALESCE(SUM(stock), 0) AS used_stock
      FROM product_variants
      WHERE product_id = $1
        AND id <> $2
      `,
      [productId, id],
    );

    const usedStockOtherSizes = Number(usedResult.rows[0].used_stock || 0);
    const newTotalSizeStock = usedStockOtherSizes + sizeStock;

    if (newTotalSizeStock > totalProductStock) {
      return res.json({
        error:
          "Size stock cannot exceed product total stock. Total stock: " +
          totalProductStock +
          ", already allocated: " +
          usedStockOtherSizes,
      });
    }

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
      [size, sku || null, price || null, cost || 0, costCode, sizeStock, id],
    );

    res.json({
      message: "Variant updated",
      variant: result.rows[0],
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
      [id],
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
      [productId],
    );

    res.json(result.rows);
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/add-variant", async (req, res) => {
  try {
    const { product_id, size, sku, price, cost, stock } = req.body;

    const sizeStock = Number(stock || 0);

    const productResult = await db.query(
      "SELECT stock FROM products WHERE id = $1",
      [product_id],
    );

    if (productResult.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    const totalProductStock = Number(productResult.rows[0].stock || 0);

    const usedResult = await db.query(
      `
      SELECT COALESCE(SUM(stock), 0) AS used_stock
      FROM product_variants
      WHERE product_id = $1
        AND size <> $2
      `,
      [product_id, size],
    );

    const usedStockOtherSizes = Number(usedResult.rows[0].used_stock || 0);
    const newTotalSizeStock = usedStockOtherSizes + sizeStock;

    if (newTotalSizeStock > totalProductStock) {
      return res.json({
        error:
          "Size stock cannot exceed product total stock. Total stock: " +
          totalProductStock +
          ", already allocated: " +
          usedStockOtherSizes,
      });
    }

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
        sizeStock,
      ],
    );

    res.json({
      message: "Variant saved",
      variant: result.rows[0],
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/product-qr/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.query("SELECT * FROM products WHERE id = $1", [id]);

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
        qr: qrImage,
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
      [Number(qty), id],
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    res.json({
      message: "Stock updated",
      product: result.rows[0],
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.put("/update-product/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { name, gender, category, subcategory, price, stock, cost } =
      req.body;

    const costCode = generateCostCode(cost);

    const result = await db.query(
      `
  UPDATE products
  SET name = $1,
      gender = $2,
      category = $3,
      subcategory = $4,
      price = $5,
      stock = $6,
      cost = $7,
      cost_code = $8
  WHERE id = $9
  RETURNING *
  `,
      [
        name,
        gender || null,
        category || null,
        subcategory || null,
        price,
        stock,
        cost || 0,
        costCode,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    res.json({
      message: "Product updated",
      product: result.rows[0],
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
  b.return_deadline,
  b.customer_id,
  b.subtotal,
  b.points_earned
FROM bill_items bi
JOIN bills b ON b.id = bi.bill_id
WHERE bi.id = $1 AND bi.bill_id = $2
      `,
      [billItemId, billId],
    );

    if (itemResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ error: "Bill item not found" });
    }

    const item = itemResult.rows[0];

    if (!override) {
      const expired =
        item.return_deadline && new Date(item.return_deadline) < new Date();

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

    const returnAmount = Number(item.price || 0) * returnQty;

let pointsDeducted = 0;

if (item.customer_id) {
  const billSubtotal = Number(item.subtotal || 0);
  const billPointsEarned = Number(item.points_earned || 0);

  if (billSubtotal > 0 && billPointsEarned > 0) {
    pointsDeducted = Math.floor(
      (returnAmount / billSubtotal) * billPointsEarned
    );
  } else {
    pointsDeducted = Math.floor(returnAmount / 100);
  }
}

    if (returnQty <= 0 || returnQty > remainingQty) {
      await client.query("ROLLBACK");
      return res.json({ error: "Invalid return quantity" });
    }

    if (item.variant_id) {
      await client.query(
        "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
        [returnQty, item.variant_id],
      );

      await client.query(
        "UPDATE products SET stock = stock + $1 WHERE id = $2",
        [returnQty, item.product_id],
      );
    } else if (item.product_id) {
      await client.query(
        "UPDATE products SET stock = stock + $1 WHERE id = $2",
        [returnQty, item.product_id],
      );
    }

    await client.query(
      "UPDATE bill_items SET returned_qty = returned_qty + $1 WHERE id = $2",
      [returnQty, billItemId],
    );

    await client.query(
      `
      INSERT INTO returns
(bill_id, bill_item_id, product_id, variant_id, size, product_name, price, qty, override_used, points_deducted)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
  override || false,
  pointsDeducted
],
    );

    await client.query("COMMIT");

    res.json({
  message: "Item returned successfully",
  pointsDeducted
});
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
        p.stock AS display_stock,
        p.stock - COALESCE(SUM(v.stock), 0) AS unallocated_stock,
        STRING_AGG(
          CASE 
            WHEN v.id IS NOT NULL THEN v.size || ': ' || v.stock
            ELSE NULL
          END,
          ', '
          ORDER BY v.id
        ) AS size_summary
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

app.delete("/delete-product/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const usedResult = await db.query(
      "SELECT id FROM bill_items WHERE product_id = $1 LIMIT 1",
      [id]
    );

    if (usedResult.rows.length > 0) {
      return res.json({
        error: "Cannot delete this product because it has sales history"
      });
    }

    const result = await db.query(
      "DELETE FROM products WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    res.json({
      message: "Product deleted",
      product: result.rows[0]
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/product/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.query("SELECT * FROM products WHERE id = $1", [id]);

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

    const billResult = await db.query("SELECT * FROM bills WHERE id = $1", [
      id,
    ]);

    if (billResult.rows.length === 0) {
      return res.json({ error: "Bill not found" });
    }

    const itemsResult = await db.query(
      "SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id ASC",
      [id],
    );

    res.json({
      bill: billResult.rows[0],
      items: itemsResult.rows,
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get("/bills", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM bills ORDER BY id DESC");

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
      [username, password],
    );

    if (result.rows.length === 0) {
      return res.json({ error: "Invalid login" });
    }

    res.json({
      message: "Login success",
      user: result.rows[0],
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.post("/add-product", async (req, res) => {
  try {
    const { name, gender, category, subcategory, price, stock, cost } =
      req.body;

    const costCode = generateCostCode(cost);

    const result = await db.query(
      `
  INSERT INTO products
  (name, gender, category, subcategory, price, stock, cost, cost_code)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *
  `,
      [
        name,
        gender || null,
        category || null,
        subcategory || null,
        price,
        stock,
        cost || 0,
        costCode,
      ],
    );

    const product = result.rows[0];
    const productId = product.id;

    const qrData = `product:${productId}`;

    QRCode.toDataURL(qrData, (err, qrImage) => {
      if (err) {
        return res.json({ error: err.message });
      }

      res.json({
        message: "Product saved",
        product,
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

    const check = await db.query("SELECT stock FROM products WHERE id = $1", [
      id,
    ]);

    if (check.rows.length === 0) {
      return res.json({ error: "Product not found" });
    }

    const stock = check.rows[0].stock;

    if (stock <= 0) {
      return res.json({ error: "Out of stock" });
    }

    await db.query("UPDATE products SET stock = stock - 1 WHERE id = $1", [id]);

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
      paymentMethod,
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
        paymentMethod || "Cash",
      ],
    );

    const billId = billResult.rows[0].id;

    for (const item of items) {
      await db.query(
        `
        INSERT INTO bill_items
        (bill_id, product_id, product_name, price, qty)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [billId, item.id, item.name, item.price, item.qty],
      );
    }

    res.json({
      message: "Bill saved",
      billId,
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
        [billId],
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
      [productName],
    );

    if (productResult.rows.length === 0) {
      return res.json({ message: "Product not found" });
    }

    const price = productResult.rows[0].price;

    await db.query("UPDATE products SET stock = stock + 1 WHERE name = $1", [
      productName,
    ]);

    await db.query(
      `
      INSERT INTO returns
      (bill_id, product_name, price, override_used)
      VALUES ($1, $2, $3, $4)
      `,
      [billId, productName, price, override || false],
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
    const result = await db.query("SELECT * FROM products WHERE stock <= 5");

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
      offlineRef,
      pointsToRedeem,
    } = req.body;

    await client.query("BEGIN");

    if (offlineRef) {
      const existingBill = await client.query(
        `
    SELECT 
      b.id,
      b.points_earned,
      c.points AS customer_total_points
    FROM bills b
    LEFT JOIN customers c ON c.id = b.customer_id
    WHERE b.offline_ref = $1
    `,
        [offlineRef],
      );

      if (existingBill.rows.length > 0) {
        await client.query("COMMIT");

        return res.json({
          message: "Bill already synced",
          billId: existingBill.rows[0].id,
          pointsEarned: existingBill.rows[0].points_earned || 0,
          customerTotalPoints: existingBill.rows[0].customer_total_points || 0,
          alreadySynced: true,
        });
      }
    }

    let customerId = null;
let redeemPoints = Number(pointsToRedeem || 0);
let pointsEarned = Math.floor(Number(total || 0) / 100);
let customerTotalPoints = 0;

if (redeemPoints > 0 && !customerPhone) {
  throw new Error("Customer phone is required to redeem points");
}

if (customerPhone) {
  const existingCustomer = await client.query(
    "SELECT * FROM customers WHERE phone = $1 FOR UPDATE",
    [customerPhone]
  );

  if (redeemPoints > 0) {
    if (existingCustomer.rows.length === 0) {
      throw new Error("Customer not found. Cannot redeem points");
    }

    const availablePoints = Number(existingCustomer.rows[0].points || 0);

    if (redeemPoints > availablePoints) {
      throw new Error("Customer has only " + availablePoints + " points");
    }

    if (redeemPoints > Number(subtotal || 0)) {
      throw new Error("Redeem points cannot exceed bill amount");
    }

    const updatedCustomer = await client.query(
      `
      UPDATE customers
      SET name = COALESCE($1, name),
          points = points - $2 + $3,
          total_spent = total_spent + $4
      WHERE phone = $5
      RETURNING *
      `,
      [
        customerName || null,
        redeemPoints,
        pointsEarned,
        total,
        customerPhone
      ]
    );

    customerId = updatedCustomer.rows[0].id;
    customerTotalPoints = updatedCustomer.rows[0].points;
  } else {
    const customerResult = await client.query(
      `
      INSERT INTO customers (name, phone, points, total_spent)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, customers.name),
        points = customers.points + EXCLUDED.points,
        total_spent = customers.total_spent + EXCLUDED.total_spent
      RETURNING *
      `,
      [
        customerName || "Walk-in",
        customerPhone,
        pointsEarned,
        total
      ]
    );

    customerId = customerResult.rows[0].id;
    customerTotalPoints = customerResult.rows[0].points;
  }
}

    const itemCostMap = {};

    for (const item of items) {
      const qty = Number(item.qty || 1);

      if (item.variant_id) {
        const stockResult = await client.query(
          `
    SELECT 
      v.stock,
      v.cost,
      v.product_id,
      p.stock AS product_stock
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id = $1
    FOR UPDATE
    `,
          [item.variant_id],
        );

        if (stockResult.rows.length === 0) {
          throw new Error(item.name + " size " + item.size + " not found");
        }

        const variantStock = Number(stockResult.rows[0].stock);
        const productStock = Number(stockResult.rows[0].product_stock);
        const productId = stockResult.rows[0].product_id;

        if (variantStock < qty) {
          throw new Error(
            item.name +
              " size " +
              item.size +
              " only has " +
              variantStock +
              " left",
          );
        }

        if (productStock < qty) {
          throw new Error(
            item.name + " only has " + productStock + " total stock left",
          );
        }

        await client.query(
          "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
          [qty, item.variant_id],
        );

        await client.query(
          "UPDATE products SET stock = stock - $1 WHERE id = $2",
          [qty, productId],
        );

        itemCostMap[item.variant_id] = Number(stockResult.rows[0].cost || 0);
      } else {
        const stockResult = await client.query(
          "SELECT stock, cost FROM products WHERE id = $1 FOR UPDATE",
          [item.id],
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
          [qty, item.id],
        );

        itemCostMap[item.id] = Number(stockResult.rows[0].cost || 0);
      }
    }

    const billResult = await client.query(
  `
  INSERT INTO bills
  (
    subtotal,
    discount,
    total,
    customer_name,
    customer_phone,
    payment_method,
    offline_ref,
    customer_id,
    points_earned,
    points_redeemed,
    point_discount,
    return_deadline
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_DATE + INTERVAL '7 days')
  RETURNING id
  `,
  [
    subtotal,
    discount,
    total,
    customerName || null,
    customerPhone || null,
    paymentMethod || "Cash",
    offlineRef || null,
    customerId,
    pointsEarned,
    redeemPoints,
    redeemPoints
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
          itemCostMap[costKey] || 0,
        ],
      );
    }

    await client.query("COMMIT");

    res.json({
  message: "Checkout completed",
  billId,
  pointsEarned,
  pointsRedeemed: redeemPoints,
  pointDiscount: redeemPoints,
  customerTotalPoints
});

  } catch (err) {
    await client.query("ROLLBACK");
    res.json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/product-insights", async (req, res) => {
  try {
    const categorySales = await db.query(`
      SELECT
        COALESCE(p.gender, '-') AS gender,
        COALESCE(p.category, '-') AS category,
        COALESCE(p.subcategory, '-') AS subcategory,
        SUM(bi.qty) AS sold_qty,
        SUM(COALESCE(bi.returned_qty, 0)) AS returned_qty,
        SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)) AS net_qty,
        SUM(
          bi.price *
          GREATEST(COALESCE(bi.qty, 1) - COALESCE(bi.returned_qty, 0), 0)
        ) AS net_revenue,
        SUM(
          (bi.price - COALESCE(bi.cost, 0)) *
          GREATEST(COALESCE(bi.qty, 1) - COALESCE(bi.returned_qty, 0), 0)
        ) AS profit
      FROM bill_items bi
      LEFT JOIN products p ON p.id = bi.product_id
      GROUP BY p.gender, p.category, p.subcategory
      ORDER BY net_qty DESC
    `);

    const trending = await db.query(`
      SELECT
        p.id AS product_id,
        p.name,
        p.gender,
        p.category,
        p.subcategory,
        p.stock,
        SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)) AS net_qty,
        SUM(
          bi.price *
          GREATEST(COALESCE(bi.qty, 1) - COALESCE(bi.returned_qty, 0), 0)
        ) AS net_revenue,
        SUM(
          (bi.price - COALESCE(bi.cost, 0)) *
          GREATEST(COALESCE(bi.qty, 1) - COALESCE(bi.returned_qty, 0), 0)
        ) AS profit
      FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id
      LEFT JOIN products p ON p.id = bi.product_id
      WHERE b.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY p.id, p.name, p.gender, p.category, p.subcategory, p.stock
      HAVING SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)) > 0
      ORDER BY net_qty DESC, net_revenue DESC
      LIMIT 10
    `);

    const slowSelling = await db.query(`
      SELECT
        p.id AS product_id,
        p.name,
        p.gender,
        p.category,
        p.subcategory,
        p.stock,
        COALESCE(SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)), 0) AS net_qty,
        MAX(b.created_at) AS last_sold_at
      FROM products p
      LEFT JOIN bill_items bi ON bi.product_id = p.id
      LEFT JOIN bills b ON b.id = bi.bill_id
      WHERE p.stock > 0
      GROUP BY p.id, p.name, p.gender, p.category, p.subcategory, p.stock
      HAVING COALESCE(SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)), 0) <= 2
      ORDER BY net_qty ASC, p.stock DESC
      LIMIT 15
    `);

    const oldStock = await db.query(`
      SELECT
        p.id AS product_id,
        p.name,
        p.gender,
        p.category,
        p.subcategory,
        p.stock,
        p.created_at,
        EXTRACT(DAY FROM NOW() - p.created_at) AS stock_age_days,
        COALESCE(SUM(bi.qty) - SUM(COALESCE(bi.returned_qty, 0)), 0) AS net_qty
      FROM products p
      LEFT JOIN bill_items bi ON bi.product_id = p.id
      WHERE p.stock > 0
      GROUP BY p.id, p.name, p.gender, p.category, p.subcategory, p.stock, p.created_at
      HAVING EXTRACT(DAY FROM NOW() - p.created_at) >= 60
      ORDER BY stock_age_days DESC, p.stock DESC
      LIMIT 15
    `);

    res.json({
      categorySales: categorySales.rows,
      trending: trending.rows,
      slowSelling: slowSelling.rows,
      oldStock: oldStock.rows
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
