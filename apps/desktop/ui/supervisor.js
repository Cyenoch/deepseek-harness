const bridge = window.dshDesktop
const body = document.body
const status = document.getElementById('status')
const detail = document.getElementById('detail')

if (bridge === undefined || status === null || detail === null) {
  throw new Error('desktop supervisor: preload bridge or status elements are missing')
}

bridge.onStatus((next) => {
  body.dataset.state = next.state
  status.textContent = next.message
  detail.textContent = next.state === 'error' ? next.detail : ''
})
