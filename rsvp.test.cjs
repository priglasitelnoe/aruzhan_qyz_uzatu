const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(reply, values = { name: 'Test Guest', attendance: 'Yes', guests: '2' }) {
  const events = {};
  const calls = [];
  const button = { disabled: false };
  let status;
  const form = {
    dataset: {},
    reportValidity: () => true,
    setAttribute() {},
    removeAttribute() {},
    appendChild(element) { status = element; },
    querySelector(selector) {
      if (selector === '.rsvp-status') return status;
      if (selector === 'input[name="Name"]') return { value: values.name };
      if (selector.includes(':checked')) return values.attendance ? { value: values.attendance } : null;
      if (selector.startsWith('input[name=') && selector !== 'input[name="Name"]') return { value: values.guests };
      return null;
    },
    querySelectorAll: selector => selector === 'input, textarea, select' ? [] : [button]
  };
  const rec = {
    querySelector: () => form,
    querySelectorAll: () => []
  };
  const context = {
    document: {
      documentElement: {},
      querySelector: () => null,
      createElement: () => ({ style: {}, setAttribute() {} }),
      addEventListener(type, handler) { events[type] = handler; }
    },
    MutationObserver: class { observe() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    AbortController,
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (reply instanceof Error) throw reply;
      return { ok: true, json: async () => reply };
    }
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/rsvp.js', 'utf8'), context);
  const click = () => events.click({
    target: { closest: () => rec },
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  });
  return { form, button, calls, click, status: () => status };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('successful submission sends matching parameters and blocks duplicates', async () => {
  const app = setup({ ok: true });
  app.click();
  app.click();
  await settle();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].options.body.get('name'), 'Test Guest');
  assert.equal(app.calls[0].options.body.get('attendance'), 'Yes');
  assert.equal(app.calls[0].options.body.get('guests'), '2');
  assert.equal(app.form.dataset.sent, 'true');
  assert.equal(app.button.disabled, true);
  app.click();
  assert.equal(app.calls.length, 1);
});

for (const reply of [{ ok: false }, new Error('Network unavailable')]) {
  test('failed submission retains answers and enables retry: ' + String(reply), async () => {
    const app = setup(reply);
    app.click();
    await settle();
    assert.equal(app.form.dataset.sent, undefined);
    assert.equal(app.button.disabled, false);
    assert.equal(app.status().style.color, '#a52424');
    app.click();
    await settle();
    assert.equal(app.calls.length, 2);
  });
}

test('missing name or attendance prevents submission', async () => {
  const app = setup({ ok: true }, { name: '', attendance: '', guests: '' });
  app.click();
  await settle();
  assert.equal(app.calls.length, 0);
  assert.equal(app.status().style.color, '#a52424');
});

test('both pages use the same script and no WhatsApp sender remains', () => {
  for (const file of ['index.html', 'aruzhan.html']) {
    const html = fs.readFileSync(__dirname + '/' + file, 'utf8');
    assert.ok(html.includes('<script src="rsvp.js"></script>'));
    assert.ok(!html.includes('sendToWhatsapp'));
    assert.ok(!html.includes('https://wa.me/'));
  }
});