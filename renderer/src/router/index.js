/**
 * Vue Router configuration
 * Cấu hình routing cho ứng dụng
 */

import { createRouter, createWebHashHistory } from 'vue-router'
import ProfileManagement from '../views/ProfileManagement.vue'
import Setting from '../views/Setting.vue'

const routes = [
  {
    path: '/',
    name: 'ProfileManagement',
    component: ProfileManagement
  },
  {
    path: '/setting',
    name: 'Setting',
    component: Setting
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router

