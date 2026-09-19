import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '@/lib/r2';
import { NextRequest, NextResponse } from 'next/server';
import { readQuotasAdmin } from '@/lib/config-admin';
import { summariseMemorialUsage } from '@/lib/quota-admin';

export const runtime = 'nodejs';

const ALLOWED_PREFIXES = ['memorials/', 'contributions/'];

function humanBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const path = formData.get('path') as string;
    const memorialId = (formData.get('memorialId') as string) || '';

    if (!file || !path) {
      return NextResponse.json({ error: 'Missing file or path' }, { status: 400 });
    }

    if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
      return NextResponse.json({ error: 'Path not allowed' }, { status: 400 });
    }

    const quotas = await readQuotasAdmin();
    if (file.size > quotas.singleFileBytesMax) {
      return NextResponse.json(
        {
          error: `That file is larger than our current limit (${humanBytes(quotas.singleFileBytesMax)}). Please compress or resize and try again.`,
        },
        { status: 413 }
      );
    }

    if (memorialId) {
      const usage = await summariseMemorialUsage(memorialId);
      if (usage.totalBytes + file.size > quotas.totalBytesPerMemorial) {
        return NextResponse.json(
          {
            error:
              `This memorial has already used most of its ${humanBytes(quotas.totalBytesPerMemorial)} of shared storage. ` +
              `We\u2019re happy to raise the limit for you \u2014 please email hello@freastar.com and we\u2019ll sort it out.`,
          },
          { status: 413 }
        );
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
        Body: buffer,
        ContentType: file.type,
      })
    );

    return NextResponse.json({ success: true, path, sizeBytes: file.size });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
