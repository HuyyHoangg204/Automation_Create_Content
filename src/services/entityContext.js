/**
 * Service để quản lý entity context (entityType, entityID, userID) theo profile
 * Context được lưu khi launch Chrome và được sử dụng khi tạo Gem
 */

class EntityContextService {
  constructor() {
    // Map: profileDirName hoặc userDataDir -> { entityType, entityID, userID }
    this.contexts = new Map();
    
    // Cleanup contexts sau 24 giờ (tránh memory leak)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000); // 1 giờ check một lần
  }

  /**
   * Lưu context cho một profile
   * @param {string} key - profileDirName hoặc userDataDir
   * @param {Object} context - { entityType, entityID, userID }
   */
  set(key, context) {
    if (!key) return;
    
    const { entityType, entityID, userID } = context || {};
    
    // Chỉ lưu nếu có đầy đủ thông tin và không phải "unknown"
    if (entityType && entityID && entityID !== 'unknown' && userID && userID !== 'unknown') {
      this.contexts.set(key, {
        entityType,
        entityID,
        userID,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Lấy context từ profileDirName hoặc userDataDir
   * @param {string} key - profileDirName hoặc userDataDir
   * @returns {Object|null} - { entityType, entityID, userID } hoặc null
   */
  get(key) {
    if (!key) return null;
    
    const context = this.contexts.get(key);
    if (!context) return null;
    
    // Kiểm tra context còn valid không (24 giờ)
    const age = Date.now() - context.timestamp;
    if (age > 24 * 60 * 60 * 1000) {
      this.contexts.delete(key);
      return null;
    }
    
    return {
      entityType: context.entityType,
      entityID: context.entityID,
      userID: context.userID
    };
  }

  /**
   * Xóa context của một profile
   * @param {string} key - profileDirName hoặc userDataDir
   */
  delete(key) {
    if (key) {
      this.contexts.delete(key);
    }
  }

  /**
   * Cleanup contexts cũ (hơn 24 giờ)
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 giờ
    
    for (const [key, context] of this.contexts.entries()) {
      const age = now - context.timestamp;
      if (age > maxAge) {
        this.contexts.delete(key);
      }
    }
  }

  /**
   * Xóa tất cả contexts (dùng cho testing hoặc reset)
   */
  clear() {
    this.contexts.clear();
  }

  /**
   * Lấy tất cả contexts (dùng cho debugging)
   */
  getAll() {
    return Array.from(this.contexts.entries()).map(([key, context]) => ({
      key,
      ...context
    }));
  }
}

// Singleton instance
const entityContextService = new EntityContextService();

module.exports = entityContextService;

