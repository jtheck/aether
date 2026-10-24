// Lambda entry. The console looks for this file. Handler stays index.handler.
// package.json "type": "module" must be in the zip so the .js imports load.
// Deploy: README "Ladder Lambda". Update function aether-ladder in us-west-2.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createAwsStore } from './awsStore.js';
import { createHandler } from './handler.js';

const allowedOrigins = String(process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const store = createAwsStore({
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  }),
  s3: new S3Client({}),
  table: process.env.TABLE,
  bucket: process.env.BUCKET,
});

export const handler = createHandler({
  store,
  season: process.env.SEASON ?? '',
  allowedOrigins,
});
