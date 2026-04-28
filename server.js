const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*"
}));

app.use(express.json());

// test route
app.get("/", (req, res) => {
  res.send("POS Cloud Running");
});

// ADD PRODUCT ROUTE (THIS IS REQUIRED)
app.post("/add-product", (req, res) => {
  console.log(req.body);

  res.json({
    message: "Product received",
    product: req.body
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});