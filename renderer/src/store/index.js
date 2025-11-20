/**
 * State management
 * Quản lý state toàn cục cho ứng dụng
 * 
 * Có thể dùng:
 * - Pinia (khuyến nghị): npm install pinia
 * - Vuex: npm install vuex@next
 * - Hoặc simple reactive state với Vue 3 Composition API
 */

import { reactive } from 'vue'

// Simple reactive store (không cần thư viện)
export const store = reactive({
  user: null,
  theme: 'dark',
  settings: {
    language: 'vi'
  },
  
  // Actions
  setUser(user) {
    this.user = user
  },
  
  setTheme(theme) {
    this.theme = theme
  },
  
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings }
  }
})

// Example với Pinia (nếu muốn dùng)
/*
import { createPinia } from 'pinia'

export const pinia = createPinia()
*/

