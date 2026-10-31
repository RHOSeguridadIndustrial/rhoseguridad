// Copy only the exact, read-only bank values displayed next to each button.
const status = document.getElementById('bank-copy-status');
let copyRevision = 0;
for (const button of document.querySelectorAll('[data-bank-copy]')) {
  button.addEventListener('click', async () => {
    const field = document.getElementById(button.dataset.bankCopy);
    if (!field || !status) return;
    const attempt = ++copyRevision;
    status.textContent = '';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(field.value);
      if (attempt !== copyRevision) return;
      status.textContent = `${button.dataset.copyLabel} copiada.`;
    } catch {
      if (attempt !== copyRevision) return;
      field.focus(); field.select(); field.setSelectionRange(0, field.value.length);
      status.textContent = 'No se pudo copiar automáticamente. El número está seleccionado; usa la opción Copiar de tu dispositivo.';
    }
  });
}
