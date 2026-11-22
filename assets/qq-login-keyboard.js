/* Native login input adapter for the bundled noVNC. Credentials stay local. */
(() => {
    if (window.qqwbLoginInput) return;
    const allowed = location.protocol === 'http:' && location.hostname === '127.0.0.1'
        && /^1608[0-3]$/.test(location.port);
    if (!allowed) return;
    let UI, keysyms;
    // evaluateJavascript has no module referrer on some Android WebViews.
    const origin = 'http://127.0.0.1:' + location.port;
    const prepare = Promise.all([import(origin + '/app/ui.js'), import(origin + '/core/input/keysymdef.js')])
        .then(([ui, keys]) => { UI = ui.default; keysyms = keys.default; return true; })
        .catch(() => false);
    const ready = () => !!(UI && UI.connected && UI.rfb && !UI.rfb.viewOnly && keysyms);
    window.qqwbLoginInput = {
        prepare,
        ready,
        showKeyboard() {
            if (!ready()) return false;
            const input = document.getElementById('noVNC_keyboardinput');
            if (!input) return false;
            input.setAttribute('inputmode', 'text');
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('autocorrect', 'off');
            input.setAttribute('autocapitalize', 'off');
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
            return document.activeElement === input;
        },
        sendText(text) {
            if (!ready() || typeof text !== 'string' || !text.length || text.length > 512
                || /[\u0000-\u001f\u007f]/.test(text)) return false;
            const rfb = UI.rfb;
            // Replace only the field the user selected; never submit the login form.
            rfb.sendKey(0xffe3, 'ControlLeft', true);
            try { rfb.sendKey(0x61, 'KeyA'); }
            finally { rfb.sendKey(0xffe3, 'ControlLeft', false); }
            for (const character of text) rfb.sendKey(keysyms.lookup(character.codePointAt(0)));
            return true;
        }
    };
})();
