const os = require('os');
const profileMonitorService = require('./profileMonitor');

class SystemInfoService {
  constructor() {
    this.lastCpuTimes = null;
  }

  // Tính CPU usage (cần đo 2 lần cách nhau 1s)
  async getCpuUsage() {
    const cpus = os.cpus();
    
    // Lần đo đầu tiên
    const times1 = cpus.map(cpu => ({
      idle: cpu.times.idle,
      total: Object.values(cpu.times).reduce((a, b) => a + b, 0)
    }));

    // Đợi 1 giây
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Lần đo thứ hai
    const cpus2 = os.cpus();
    const times2 = cpus2.map(cpu => ({
      idle: cpu.times.idle,
      total: Object.values(cpu.times).reduce((a, b) => a + b, 0)
    }));

    // Tính usage cho từng core
    const usage = times1.map((t1, i) => {
      const t2 = times2[i];
      const idle = t2.idle - t1.idle;
      const total = t2.total - t1.total;
      return 100 - (idle / total) * 100;
    });

    // Trả về average usage
    const averageUsage = usage.reduce((a, b) => a + b, 0) / usage.length;
    return parseFloat(averageUsage.toFixed(2));
  }

  // Lấy thông tin hệ thống (chỉ lấy những gì cần)
  async getSystemInfo() {
    try {
      // CPU usage
      const cpuUsage = await this.getCpuUsage();
      
      // Memory info
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const freeGB = parseFloat((freeMem / 1024 / 1024 / 1024).toFixed(2));

      // Profiles info
      const allProfiles = profileMonitorService.getAllMonitoredProfiles();
      const runningProfiles = allProfiles.filter(p => p.status === 'running');
      const profileRunning = runningProfiles.length;

      return {
        cpu: {
          usage: cpuUsage
        },
        memory: {
          freeGB: freeGB
        },
        profiles: {
          running: profileRunning
        }
      };
    } catch (error) {
      console.error('[SystemInfoService] Error getting system info:', error);
      // Trả về default values nếu có lỗi
      return {
        cpu: {
          usage: 0
        },
        memory: {
          freeGB: 0
        },
        profiles: {
          running: 0
        }
      };
    }
  }
}

module.exports = new SystemInfoService();

