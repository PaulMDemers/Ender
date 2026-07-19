process.env.PORT = String(process.env.ENDER_TEST_API_PORT || "3000");

require("../src/server").main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
