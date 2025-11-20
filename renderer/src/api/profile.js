/**
 * Profile API Service
 * Gọi API để lấy danh sách Chrome profiles
 */

import { API_BASE_URL } from '@/constants/constants.js'

export class ProfileAPI {
  /**
   * Create new Chrome profile
   * POST /chrome/profiles
   * Body: { name: "string" }
   */
  static async create(name) {
    try {
      const response = await fetch(`${API_BASE_URL}/chrome/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error creating profile:', error)
      throw error
    }
  }

  /**
   * Get all profiles
   * GET /chrome/profiles
   */
  static async getAll() {
    try {
      const response = await fetch(`${API_BASE_URL}/chrome/profiles`)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error fetching profiles:', error)
      throw error
    }
  }

  /**
   * Launch Chrome profile
   * POST /chrome/profiles/launch
   * Body: { name, userDataDir, profileDirName, extraArgs }
   */
  static async launch({ name, userDataDir, profileDirName, extraArgs = ['--start-maximized'] }) {
    try {
      const response = await fetch(`${API_BASE_URL}/chrome/profiles/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          userDataDir,
          profileDirName,
          extraArgs,
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error launching profile:', error)
      throw error
    }
  }

  /**
   * Stop Chrome profile
   * POST /chrome/profiles/stop
   * Body: { name, userDataDir, profileDirName }
   */
  static async stop({ name, userDataDir, profileDirName }) {
    try {
      const response = await fetch(`${API_BASE_URL}/chrome/profiles/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          userDataDir,
          profileDirName,
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error stopping profile:', error)
      throw error
    }
  }

  /**
   * Get profiles folder path
   * GET /chrome/profiles-folder
   */
  static async getProfilesFolder() {
    try {
      const response = await fetch(`${API_BASE_URL}/chrome/profiles-folder`)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error getting profiles folder:', error)
      throw error
    }
  }

  /**
   * Set profiles folder path
   * PUT /chrome/profiles-folder
   * Body: { folder: "string" }
   */
  static async setProfilesFolder(folder) {
    try {
      const response = await fetch(`${API_BASE_URL}/chrome/profiles-folder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder,
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error setting profiles folder:', error)
      throw error
    }
  }
}

