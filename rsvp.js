(function () {
  const googleSheetsUrl = "https://script.google.com/macros/s/AKfycbwSvwmNZZHYqmasI8d2z83hGlqEYd9jA5fku11SyKHQ7wewgl3-JACthY_3-WQmV-fb/exec";
  const formSelector = '#rec2295139613';

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isTechnicalName(name) {
    const key = clean(name).toLowerCase();
    return !key ||
      key.indexOf('formservices') !== -1 ||
      key.indexOf('tildaspec') !== -1 ||
      key.indexOf('tildaservices') !== -1 ||
      key.indexOf('form-spec') !== -1 ||
      key.indexOf('formid') !== -1 ||
      key.indexOf('tranid') !== -1 ||
      key.indexOf('projectid') !== -1 ||
      key.indexOf('pageid') !== -1 ||
      key.indexOf('recid') !== -1 ||
      key.indexOf('requestid') !== -1;
  }

  function prettyName(name) {
    const key = clean(name).replace(/:$/, '');
    if (isTechnicalName(key)) return '';
    if (key === 'Name' || /есім|name/i.test(key)) return 'Есім(дер)іңіз';
    if (/қатысу/i.test(key)) return 'Қатысуыңыз';
    if (/қонақ/i.test(key)) return 'Қонақтар саны';
    return '';
  }

  function fieldValue(form, selectors) {
    for (let i = 0; i < selectors.length; i += 1) {
      const field = form.querySelector(selectors[i]);
      if (!field) continue;
      const type = (field.type || '').toLowerCase();
      if ((type === 'radio' || type === 'checkbox') && !field.checked) continue;
      const value = clean(field.value);
      if (value) return value;
    }
    return '';
  }

  function checkedText(input) {
    if (!input) return '';
    const value = clean(input.value);
    if (value && !isTechnicalName(value) && value !== 'on') return value;

    const label = input.closest('label');
    if (label) {
      const text = clean(label.textContent);
      if (text) return text;
    }

    const id = input.id;
    if (id) {
      const labelByFor = document.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
      if (labelByFor) return clean(labelByFor.textContent);
    }

    return '';
  }

  function readForm(form) {
    const result = new Map();

    function add(label, value) {
      const text = clean(value);
      if (label && text && !result.has(label)) result.set(label, text);
    }

    add('Есім(дер)іңіз', fieldValue(form, [
      'input[name="Name"]',
      'textarea[name="Name"]',
      'input[placeholder*="Есім"]',
      'textarea[placeholder*="Есім"]'
    ]));

    const checkedAttendance = form.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked');
    add('Қатысуыңыз', checkedText(checkedAttendance));

    add('Қонақтар саны', fieldValue(form, [
      'input[name="Қонақтар саны"]',
      'select[name="Қонақтар саны"]',
      'input[name*="Қонақ"]',
      'select[name*="Қонақ"]',
      '.t-inputquantity__input',
      '.t-input-quantity input'
    ]));

    form.querySelectorAll('input, textarea, select').forEach(function (field) {
      const type = (field.type || '').toLowerCase();
      if (field.disabled || type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') return;
      if ((type === 'radio' || type === 'checkbox') && !field.checked) return;

      const label = prettyName(field.name || field.getAttribute('data-name') || field.placeholder || field.getAttribute('aria-label'));
      add(label, field.value);
    });

    return ['Есім(дер)іңіз', 'Қатысуыңыз', 'Қонақтар саны']
      .filter(function (label) { return result.has(label); })
      .map(function (label) { return [label, result.get(label)]; });
  }

  function disableTildaServiceFields(root) {
    root.querySelectorAll('input, textarea, select').forEach(function (field) {
      const name = field.name || field.getAttribute('name') || '';
      if (isTechnicalName(name) || (field.type || '').toLowerCase() === 'hidden') {
        field.disabled = true;
      }
    });

    root.querySelectorAll('form').forEach(function (form) {
      form.setAttribute('action', '');
      form.setAttribute('method', 'get');
      form.removeAttribute('data-success-callback');
    });

    root.querySelectorAll('button, input[type="submit"], .t-submit').forEach(function (button) {
      if (button.tagName === 'BUTTON') button.setAttribute('type', 'button');
      if (button.tagName === 'INPUT') button.setAttribute('type', 'button');
    });
  }

  function showStatus(form, message, error) {
    let status = form.querySelector('.rsvp-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'rsvp-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.style.cssText = 'margin-top:16px;font-size:16px;line-height:1.5;text-align:center;';
      form.appendChild(status);
    }
    status.style.color = error ? '#a52424' : '#285c36';
    status.textContent = message;
  }

  async function sendToGoogleSheets(form) {
    if (form.dataset.sending === 'true' || form.dataset.sent === 'true') return;
    if (form && typeof form.reportValidity === 'function' && !form.reportValidity()) return;

    const answers = new Map(readForm(form));
    const name = answers.get('Есім(дер)іңіз') || '';
    const attendance = answers.get('Қатысуыңыз') || '';
    if (!name || !attendance) {
      showStatus(form, 'Есіміңізді жазып, қатысу жауабын таңдаңыз.', true);
      return;
    }

    const buttons = Array.from(form.querySelectorAll('button, input[type="button"], input[type="submit"], .t-submit'));
    const previousDisabled = buttons.map(function (button) { return button.disabled; });
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, 30000);
    form.dataset.sending = 'true';
    form.setAttribute('aria-busy', 'true');
    buttons.forEach(function (button) { button.disabled = true; });
    showStatus(form, 'Жауабыңыз жіберілуде…', false);

    try {
      const response = await fetch(googleSheetsUrl, {
        method: 'POST',
        body: new URLSearchParams({
          name: name,
          attendance: attendance,
          guests: answers.get('Қонақтар саны') || ''
        }),
        signal: controller.signal,
        credentials: 'omit'
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      if (result.ok !== true) throw new Error('Answer was not saved');
      form.dataset.sent = 'true';
      showStatus(form, 'Рақмет! Жауабыңыз қабылданды.', false);
    } catch (error) {
      showStatus(form, 'Жауаптың сақталғанын растау мүмкін болмады. Интернетті тексеріп, қайталап көріңіз.', true);
    } finally {
      clearTimeout(timeout);
      delete form.dataset.sending;
      form.removeAttribute('aria-busy');
      buttons.forEach(function (button, index) {
        button.disabled = form.dataset.sent === 'true' || previousDisabled[index];
      });
    }
  }

  function handleSendEvent(event) {
    const rec = event.target.closest(formSelector);
    if (!rec) return;
    const form = rec.querySelector('form') || rec;
    disableTildaServiceFields(rec);
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    sendToGoogleSheets(form);
  }

  document.addEventListener('submit', function (event) {
    const form = event.target.closest(formSelector + ' form');
    if (!form) return;
    handleSendEvent(event);
  }, true);

  document.addEventListener('click', function (event) {
    const button = event.target.closest(formSelector + ' button, ' + formSelector + ' input[type="submit"], ' + formSelector + ' input[type="button"], ' + formSelector + ' .t-submit, ' + formSelector + ' [role="button"]');
    if (!button) return;
    handleSendEvent(event);
  }, true);

  function initGoogleSheetsForm() {
    const rec = document.querySelector(formSelector);
    if (rec) disableTildaServiceFields(rec);
  }

  document.addEventListener('DOMContentLoaded', initGoogleSheetsForm);
  setTimeout(initGoogleSheetsForm, 800);
  setTimeout(initGoogleSheetsForm, 2000);
  new MutationObserver(initGoogleSheetsForm).observe(document.documentElement, { childList: true, subtree: true });
})();
