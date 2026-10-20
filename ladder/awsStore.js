import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

async function readBody(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function createAwsStore({ ddb, s3, table, bucket }) {
  return {
    async putReportIfAbsent(item) {
      try {
        await ddb.send(new PutCommand({
          TableName: table,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
        return { created: true, existing: item };
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
        const got = await ddb.send(new GetCommand({
          TableName: table,
          Key: { pk: item.pk, sk: item.sk },
        }));
        return { created: false, existing: got.Item ?? null };
      }
    },
    async listByPrefix(pk, prefix) {
      const items = [];
      let start;
      do {
        const out = await ddb.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': prefix },
          ExclusiveStartKey: start,
        }));
        if (out.Items?.length) items.push(...out.Items);
        start = out.LastEvaluatedKey;
      } while (start);
      return items;
    },
    async getItem(pk, sk) {
      const got = await ddb.send(new GetCommand({
        TableName: table,
        Key: { pk, sk },
      }));
      return got.Item ?? null;
    },
    async settle({ settled, players }) {
      const transact = [
        {
          Put: {
            TableName: table,
            Item: settled,
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
        ...players.map((player) => ({
          Update: {
            TableName: table,
            Key: { pk: player.pk, sk: player.sk },
            UpdateExpression: 'SET playerId = :playerId, #name = :name, rating = :rating, games = :games, wins = :wins',
            ExpressionAttributeNames: { '#name': 'name' },
            ConditionExpression: 'attribute_not_exists(rating) OR (rating = :old AND games = :oldGames)',
            ExpressionAttributeValues: {
              ':playerId': player.playerId,
              ':name': player.name || '',
              ':rating': player.rating,
              ':games': player.games,
              ':wins': player.wins,
              ':old': player.oldRating,
              ':oldGames': player.oldGames,
            },
          },
        })),
      ];
      try {
        await ddb.send(new TransactWriteCommand({ TransactItems: transact }));
        return { ok: true };
      } catch (err) {
        if (err.name !== 'TransactionCanceledException') throw err;
        const reasons = err.CancellationReasons ?? [];
        if (reasons[0]?.Code === 'ConditionalCheckFailed') return { ok: false, reason: 'exists' };
        return { ok: false, reason: 'conflict' };
      }
    },
    async getObject(key) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await readBody(out.Body);
      } catch (err) {
        const status = err.$metadata?.httpStatusCode;
        if (err.name === 'NoSuchKey' || err.name === 'NotFound' || status === 404 || status === 403) return null;
        throw err;
      }
    },
    async putObject(key, body) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
        CacheControl: 'no-cache',
      }));
    },
    async putItem(item) {
      await ddb.send(new PutCommand({ TableName: table, Item: item }));
    },
    async deleteItem(pk, sk) {
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk, sk } }));
    },
    async pairQueue({ deletes, puts }) {
      const transact = [
        ...deletes.map((key) => ({
          Delete: {
            TableName: table,
            Key: { pk: key.pk, sk: key.sk },
            ConditionExpression: 'attribute_exists(pk)',
          },
        })),
        ...puts.map((item) => ({
          Put: { TableName: table, Item: item },
        })),
      ];
      try {
        await ddb.send(new TransactWriteCommand({ TransactItems: transact }));
        return { ok: true };
      } catch (err) {
        if (err.name !== 'TransactionCanceledException') throw err;
        return { ok: false };
      }
    },
  };
}
