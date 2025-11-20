<template>
  <aside class="w-64 bg-[#0d1b2a] border-r border-gray-800 flex flex-col">
    <!-- Logo -->
    <div class="p-6 border-b border-gray-800">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span class="text-lg font-semibold text-white">hidemium</span>
      </div>
    </div>

    <!-- Menu Items -->
    <nav class="flex-1 overflow-y-auto py-4">
      <div v-for="item in menuItems" :key="item.id" class="px-3 mb-1">
        <router-link
          :to="item.route || '/'"
          @click="selectMenu(item.id)"
          :class="[
            'w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200',
            $route.path === item.route
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
          ]"
        >
        <div class="flex items-center gap-3">
          <component :is="item.icon" class="w-5 h-5" />
          <span class="text-sm font-medium">{{ item.label }}</span>
        </div>
          <span 
            v-if="item.badge" 
            class="ml-auto text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full"
          >
            {{ item.badge }}
          </span>
        </router-link>
      </div>
    </nav>

    <!-- Bottom Section -->
    <div class="p-4 border-t border-gray-800">
      <div class="flex items-center gap-3 px-3 py-2">
        <div class="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-xs font-bold">
          U
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-white truncate">User Account</p>
          <p class="text-xs text-gray-400 truncate">user@example.com</p>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref } from 'vue'
import { AnOutlinedSetting, BxUser  } from '@kalimahapps/vue-icons';

const selectedMenu = ref('profile')

const menuItems = [
  { id: 'profile', label: 'Profile', icon: BxUser, route: '/' },
  { id: 'setting', label: 'Setting', icon: AnOutlinedSetting, route: '/setting' },
]

const selectMenu = (id) => {
  selectedMenu.value = id
}
</script>

<style scoped>
a {
  text-decoration: none;
  display: block;
}
</style>

