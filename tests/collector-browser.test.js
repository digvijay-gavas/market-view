import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractHoldings,waitReady} from '../automation/browser.mjs';
test('real browser parses complete holdings and rejects incomplete tables and repeated PIN attempts',{skip:!process.env.COLLECTOR_BROWSER_TESTS},async()=>{
 const {chromium}=await import('playwright');const browser=await chromium.launch({channel:process.env.COLLECTOR_TEST_BROWSER||'chrome',headless:true});
 try{
  const page=await browser.newPage();await page.route('https://groww.in/**',r=>r.fulfill({body:'<html><body>Enter PIN<input type="password" maxlength="4"><button>Continue</button></body></html>',contentType:'text/html'}));await page.goto('https://groww.in/synthetic-collector-test');let attempts=0;
  await assert.rejects(waitReady(page,{pin:'1234',onPinAttempt:async()=>{attempts++;},delay:async()=>{}}),e=>e.code==='PIN_REJECTED');assert.equal(attempts,1);
  await page.setContent('<h1>HOLDINGS (1)</h1><table><tr class="holdingRow_tablerow"><td><a href="/stocks/example">Example</a>2 shares Avg. ₹100.00 ₹110.00 +1.00 (1.00%) +₹20.00 10.00% ₹220.00 ₹200.00</td></tr></table>');
  assert.equal(await waitReady(page,{delay:async()=>{}}),'rows');const parsed=await page.evaluate(extractHoldings);assert.equal(parsed.rows[0].qty,2);assert.equal(parsed.rows[0].invested,200);assert.equal(parsed.rows[0].reference_value,220);
  await page.evaluate(()=>document.querySelector('h1').textContent='HOLDINGS (2)');assert.equal((await page.evaluate(extractHoldings)).error,'PARTIAL_HOLDINGS');
 }finally{await browser.close();}
});
