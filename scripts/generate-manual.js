// Genera docs/Guia-uso-Dashboard-Comercial-GROWTH.pdf a partir de
// docs/guia-uso-dashboard-comercial.html (fuente editable). Uso:
//   node scripts/generate-manual.js
const path = require("path");
const puppeteer = require("puppeteer");

async function main() {
  const htmlPath = path.join(__dirname, "..", "docs", "guia-uso-dashboard-comercial.html");
  const outPath = path.join(__dirname, "..", "docs", "Guia-uso-Dashboard-Comercial-GROWTH.pdf");

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto("file://" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle0" });
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await browser.close();
  console.log("PDF generado en:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
