/* global window, document, Headers */
import assert from "node:assert/strict";
import { v7 } from "uuid";

const section = "section[aria-labelledby='audio-timeline-save-heading']";
const button = `css:${section} button[type=button]:last-child`;

// Both checks run in the authenticated, disposable PG fixture.
export async function verifyMissingTimelineBasis(page) {
  const state = await page.evaluate(selector => {
    const panel = document.querySelector(selector);
    return { text: panel?.textContent, disabled: panel?.querySelector("button:last-child")?.disabled };
  }, section);
  assert.match(state.text, /장면 제작을 승인/);
  assert.match(state.text, /기준 타임라인을 먼저 저장/);
  assert.equal(state.disabled, true);
}

export async function verifyTimelineSaveRecovery(page) {
  await page.waitForSelector(`${button}:enabled`);
  await page.evaluate(() => {
    const send = window.fetch.bind(window);
    window.timelinePosts = [];
    window.externalTimelineWrite = (url, init) => send(url, init).then(async res => ({ status: res.status, data: await res.json() }));
    window.fetch = async (url, init) => {
      const response = await send(url, init);
      if (init?.method === "POST" && String(url).endsWith("/timeline/audio-clips")) {
        const result = await response.clone().json();
        const first = window.timelinePosts.length === 0;
        window.timelinePosts.push({ url, body: JSON.parse(init.body), key: new Headers(init.headers).get("Idempotency-Key"), status: response.status, result });
        if (first) throw new TypeError("simulated lost response");
      }
      return response;
    };
  });
  await page.click(button);
  await page.waitForSelector(`css:${section} [role=alert]`);
  const retryText = await page.evaluate(selector => document.querySelector(selector).textContent, button.slice(4));
  assert.match(retryText, /같은 저장 요청 다시 확인/);
  await page.click(button);
  await verifyTimelineConcurrentRefresh(page);
}

export async function verifyTimelineConcurrentRefresh(page) {
  await page.waitForSelector(`${button}:enabled`);
  const posts = await page.evaluate(() => window.timelinePosts);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].status, 200);
  assert.deepEqual(posts[1], posts[0]);
  const saved = await page.evaluate(selector => document.querySelector(selector).textContent, section);
  assert.match(saved, new RegExp(`타임라인 r${posts[0].result.timelineRevision}`));

  const external = await page.evaluate(async ({ savedPost, key }) => await window.externalTimelineWrite(savedPost.url, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ assetId: savedPost.body.assetId, expectedContentRevision: savedPost.result.contentRevision, expectedTimelineId: savedPost.result.timelineId }),
  }), { savedPost: posts[0], key: v7() });
  assert.equal(external.status, 200);
  await page.click(button);
  await page.waitForSelector(`css:${section} [role=alert]`);
  await page.waitForSelector(`${button}:enabled`);
  const conflict = await page.evaluate(selector => ({
    message: document.querySelector(selector + " [role=alert]").textContent,
    post: window.timelinePosts.at(-1),
  }), section);
  assert.match(conflict.message, /저장 기준이 달라졌어요/);
  assert.equal(conflict.post.result.code, "CURRENT_TIMELINE_CONFLICT");
  assert.equal(conflict.post.body.expectedContentRevision, posts[0].result.contentRevision);
}
