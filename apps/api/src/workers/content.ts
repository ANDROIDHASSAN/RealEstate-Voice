import { facebook, instagram, video, youtube } from '@truecode/integrations';
import type { SendResult } from '@truecode/integrations';
import { logger } from '../logger.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { Account, ContentPost, VideoJob } from '../models.js';

interface PublishResult {
  platform: string;
  status: string;
  externalId?: string;
  error?: string;
}

/**
 * Publish one post to one platform through the right adapter. Platforms without
 * a dedicated adapter yet (tiktok/linkedin) return a labeled mock result rather
 * than faking success — consistent with the stub-vs-live rule.
 */
async function publishToPlatform(
  platform: string,
  accountId: string,
  post: { title?: string | null; caption: string; mediaUrl?: string },
): Promise<PublishResult> {
  const media = post.mediaUrl;
  let r: SendResult;
  switch (platform) {
    case 'instagram':
      r = await instagram.publishPost(accountId, post.caption, media);
      break;
    case 'facebook':
      r = await facebook.publishPost(post.caption, media);
      break;
    case 'youtube':
      r = await youtube.uploadVideo({ title: post.title || post.caption.slice(0, 90), description: post.caption, videoUrl: media });
      break;
    default:
      // tiktok / linkedin — adapter pending; labeled stub, never fake-live.
      console.info(`[STUB][${platform}] would publish: "${post.caption.slice(0, 60)}…"`);
      r = { ok: true, id: `${platform}_mock`, status: 'mock-sent' };
  }
  return { platform, status: r.status, externalId: r.id, error: r.error };
}

/** M6 publish + M8 render workers. Stub adapters are labeled, never fake. */
export function registerContentWorkers(): void {
  const queue = getQueue();

  queue.process(QUEUES.contentPublish, async (data) => {
    const post = await ContentPost.findById(String(data.postId));
    if (!post || (post.status !== 'scheduled' && post.status !== 'publishing')) return;
    const account = await Account.findById(post.accountId).select('_id').lean();
    if (!account) return;

    post.status = 'publishing';
    await post.save();

    const platforms = post.platforms?.length ? post.platforms : ['instagram'];
    const mediaUrl = post.mediaUrls?.[0] ?? post.mediaUrl ?? undefined;
    const results: PublishResult[] = [];
    for (const platform of platforms) {
      results.push(await publishToPlatform(platform, String(account._id), { title: post.title, caption: post.caption, mediaUrl }));
    }

    const anyLive = results.some((r) => r.status === 'sent');
    const anyFailed = results.some((r) => r.status === 'failed');
    const allFailed = results.every((r) => r.status === 'failed');
    post.status = allFailed ? 'failed' : anyFailed ? 'partial' : anyLive ? 'published' : 'stub-published';
    post.set('results', results);
    await post.save();
    logger.info({ postId: String(post._id), status: post.status, platforms }, 'content publish processed');
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
