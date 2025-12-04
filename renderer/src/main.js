import { createApp } from 'vue'
import './styles/main.css'
import 'primeicons/primeicons.css'
import App from './App.vue'
import router from './router'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import { AnOutlinedSetting, } from '@kalimahapps/vue-icons';

const app = createApp(App)

app.use(router)
app.use(ToastService)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
      cssLayer: false
    }
  }
})
app.mount('#app').$nextTick(() => {
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
  
  // Listen for logs from main process
  window.ipcRenderer.on('main-process-log', (_event, logData) => {
    const { timestamp, level, message, data } = logData
    const logPrefix = `[Main Process] [${new Date(timestamp).toLocaleTimeString()}]`
    
    if (level === 'error') {
      console.error(`%c${logPrefix} ${message}`, 'color: red; font-weight: bold', data || '')
    } else if (level === 'warn') {
      console.warn(`${logPrefix} ${message}`, data || '')
    } else if (level === 'success') {
      console.log(`%c${logPrefix} ${message}`, 'color: green; font-weight: bold', data || '')
    } else {
      console.log(`${logPrefix} ${message}`, data || '')
    }
  })
})


