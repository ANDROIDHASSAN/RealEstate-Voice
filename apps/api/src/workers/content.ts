import { instagram, video } from '@closeflow/integrations';
import { logger } from '../logger.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { Account, ContentPost, VideoJob } from '../models.js';

/** M6 publish + M8 render workers. Stub adapters are labeled, never fake. */
export function registerContentWorkers(): void {
  const queue = getQueue();

  queue.process(QUEUES.contentPublish, async (data) => {
    const post = await ContentPost.findById(String(data.postId));
    if (!post || post.status !== 'scheduled') return;
    const account = await Account.findById(post.accountId).select('_id').lean();
    if (!account) return;
    const result = await instagram.publishPost(String(account._id), post.caption, post.mediaUrl ?? undefined);
    post.status = result.status === 'mock-sent' ? 'stub-published' : result.ok ? 'published' : 'failed';
    await post.save();
    logger.info({ postId: String(post._id), status: post.status }, 'content publish processed');
  });

  queue.process(QUEUES.videoRender, async (data) => {
    const job = await VideoJob.findById(String(data.jobId));
    if (!job) return;
    job.status = 'rendering';
    await job.save();
    try {
      const result = await video.render({ title: job.title, script: job.script });
      job.renderUrl = result.renderUrl;
      job.stub = result.stub;
      job.status = 'done';
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
    }
    await job.save();
    logger.info({ jobId: String(job._id), status: job.status, stub: job.stub }, 'video render processed');
  });
}
