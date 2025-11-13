const { randomUUID } = require('crypto');
const { InMemoryQueue } = require('./queue');
const { runStep } = require('./actions');
const { logger } = require('../logger');

const jobs = new Map();
const queue = new InMemoryQueue();
let isProcessing = false;

function createJob(script) {
  const id = randomUUID();
  const job = {
    id,
    status: 'queued',
    script,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    while (queue.size() > 0) {
      const jobId = queue.shift();
      const job = jobs.get(jobId);
      if (!job) continue;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      try {
        for (const step of job.script.steps) {
          // small safety delay to avoid overwhelming the system
          // eslint-disable-next-line no-await-in-loop
          await runStep(step);
        }
        job.status = 'completed';
      } catch (err) {
        job.status = 'failed';
        job.error = err?.message || String(err);
        logger.error({ err, jobId }, 'Job failed');
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    }
  } finally {
    isProcessing = false;
  }
}

function submitScript(script) {
  const job = createJob(script);
  queue.push(job.id);
  // Fire-and-forget
  processQueue().catch((err) => logger.error({ err }, 'Queue processor error'));
  return job.id;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function listJobs() {
  return Array.from(jobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { submitScript, getJob, listJobs };


