// Fenêtres de dialogue dessinées dans la page.
// Les alert()/confirm() du navigateur sont bloqués quand l'application s'affiche dans le
// cadre du kiosque (page locale de reprise automatique) : la page se figeait.
(function () {
    function box(message, buttons) {
        return new Promise(resolve => {
            const back = document.createElement('div');
            back.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.75);' +
                                 'display:flex;align-items:center;justify-content:center;font-family:sans-serif';
            const card = document.createElement('div');
            card.style.cssText = 'background:#1c2833;border:3px solid #f39c12;border-radius:14px;padding:22px 26px;' +
                                 'max-width:520px;text-align:center;color:#eee;font-size:17px;line-height:1.5';
            const text = document.createElement('div');
            text.style.cssText = 'white-space:pre-line;margin-bottom:18px';
            text.textContent = message;
            card.appendChild(text);
            buttons.forEach(([label, value, color]) => {
                const b = document.createElement('button');
                b.textContent = label;
                b.style.cssText = `margin:4px 6px;padding:14px 26px;font-size:17px;font-weight:bold;border:0;` +
                                  `border-radius:9px;color:#fff;cursor:pointer;background:${color}`;
                b.onclick = () => { back.remove(); resolve(value); };
                card.appendChild(b);
            });
            back.appendChild(card);
            document.body.appendChild(back);
        });
    }
    window.uiAlert = (message) => box(message, [['OK', true, '#2980b9']]);
    window.uiConfirm = (message, okLabel = 'OK', cancelLabel = 'Annuler') =>
        box(message, [[okLabel, true, '#27ae60'], [cancelLabel, false, '#7f8c8d']]);
})();
