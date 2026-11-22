// SPDX-License-Identifier: AGPL-3.0-only
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { Config } from '../config/config.js';

export function createS3Client(s3: Config['s3']): S3Client {
  return new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
  });
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NotFound' ||
      error.name === 'NoSuchBucket' ||
      error.$metadata.httpStatusCode === 404)
  );
}

/** Creates the bucket when it does not exist. Returns true when it was created. */
export async function ensureBucket(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return false;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return true;
}
