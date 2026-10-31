export function initPwa({ onReconnect }) {
  const notice = document.querySelector('#offline-notice');
  const connection = () => { notice.hidden = navigator.onLine; };
  connection();
  window.addEventListener('offline', connection);
  window.addEventListener('online', () => { connection(); onReconnect(); });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  document.querySelector('#pwa-mode').textContent = standalone ? 'ホーム画面版で利用しています。' : 'ホーム画面に追加すると、アプリのように起動できます。';
}
