const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000/');
  
  await page.waitForTimeout(2000);
  
  // Click on "Model Exchange" tab explicitly
  await page.evaluate(() => {
     const tabs = document.querySelectorAll('.tab-button');
     for(let t of tabs) {
        if(t.textContent.includes('Model Exchange')) {
           t.click();
           return;
        }
     }
  });

  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'screenshot_task2.png', fullPage: true });
  await browser.close();
})();
