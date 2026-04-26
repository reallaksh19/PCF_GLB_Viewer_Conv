const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000/viewer/index.html');
  await page.waitForTimeout(2000); // let UI render

  // Get all tab buttons
  const tabs = await page.$$('nav#tab-bar button');

  for (let i = 0; i < tabs.length; i++) {
    const tabName = await tabs[i].innerText();
    const cleanName = tabName.replace(/[^a-zA-Z0-9]/g, '_');

    await tabs[i].click();
    await page.waitForTimeout(1000); // Wait for tab to switch

    await page.screenshot({ path: `tab_${i}_${cleanName}.png`, fullPage: true });
    console.log(`Took screenshot of ${tabName} tab`);
  }

  await browser.close();
  console.log("All tab screenshots taken.");
})();
