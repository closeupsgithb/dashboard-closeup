// Genera los 3 PDF de contrato +Reformas System a partir de
// public/materiales-comerciales/generador-contrato-reformas-system.html
// (fuente editable, única para las 3 modalidades). El HTML ya trae su propio
// @page { size: A4; margin: 0 } y encabezado de página por página, así que
// aquí no se añade margen ni header/footer de Puppeteer — sería duplicarlo
// (a diferencia de generate-guion-comercial.js, cuya fuente no lo trae).
// Uso: node scripts/generate-contrato-reformas-system.js
const path = require("path");
const puppeteer = require("puppeteer");

const HTML_PATH = path.join(__dirname, "..", "public", "materiales-comerciales", "generador-contrato-reformas-system.html");

const VARIANTS = [
  { value: "single_ads_included", out: "contrato-reformas-system-2997.pdf" },
  { value: "single_ads_separate", out: "contrato-reformas-system-publicidad-aparte.pdf" },
  { value: "split_ads_included", out: "contrato-reformas-system-1500.pdf" },
];

async function main() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto("file://" + HTML_PATH.replace(/\\/g, "/"), { waitUntil: "networkidle0" });

  for (const variant of VARIANTS) {
    await page.evaluate((value) => {
      const input = document.querySelector('input[name="modalidad"][value="' + value + '"]');
      if (!input) throw new Error("No se encontró el radio de modalidad: " + value);
      input.checked = true;
      input.dispatchEvent(new Event("change"));
    }, variant.value);

    const outPath = path.join(__dirname, "..", "public", "materiales-comerciales", variant.out);
    await page.pdf({
      path: outPath,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    console.log("PDF generado:", outPath);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
