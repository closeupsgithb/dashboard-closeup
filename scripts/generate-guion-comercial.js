// Genera el PDF del Guion Comercial +Reformas System a partir de
// public/materiales-comerciales/guion-comercial-reformas-system.html
// (fuente editable). Uso:
//   node scripts/generate-guion-comercial.js [ruta-salida.pdf]
const path = require("path");
const puppeteer = require("puppeteer");

async function main() {
  const htmlName = process.argv[3] || "guion-comercial-reformas-system.html";
  const htmlPath = path.join(__dirname, "..", "public", "materiales-comerciales", htmlName);
  const outPath = process.argv[2] || path.join(__dirname, "..", "public", "materiales-comerciales", "guion-comercial-reformas-system.pdf");

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto("file://" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle0" });
  await page.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", bottom: "14mm", left: "18mm", right: "18mm" },
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width:100%; font-size:7.5pt; color:#9a9a9a; font-family:'Segoe UI',Arial,sans-serif; text-align:right; padding:0 18mm; -webkit-print-color-adjust:exact;">
        +Reformas System — Guion de Venta · Confidencial
      </div>`,
    footerTemplate: `
      <div style="width:100%; font-size:8pt; color:#9a9a9a; font-family:'Segoe UI',Arial,sans-serif; text-align:center;">
        <span class="pageNumber"></span>
      </div>`,
  });
  await browser.close();
  console.log("PDF generado en:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
