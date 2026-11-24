import mongoose from 'mongoose';
import { env } from '../src/config/env.config.js';

// Build the replacement unique index first; only then remove the known old index.
// Run without --apply to inspect the plan. Run --apply during a controlled rollout.
async function main() {
  await mongoose.connect(env.mongoUri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const collection = mongoose.connection.collection('employees');
  const indexes = await collection.indexes();
  const old = indexes.find(index => index.name === 'email_1');
  const replacement = indexes.find(index => index.name === 'active_email_unique_v2');
  if (old && (old.unique !== true || old.key.email !== 1 || Object.keys(old.key).length !== 1 || JSON.stringify(old.partialFilterExpression) !== JSON.stringify({ isActive: true }))) throw new Error('The existing email_1 index differs from the expected index; inspect it manually.');
  if (replacement && (replacement.unique !== true || JSON.stringify(replacement.key) !== JSON.stringify({ email: 1, isActive: 1 }) || JSON.stringify(replacement.partialFilterExpression) !== JSON.stringify({ isActive: true, email: { $type: 'string' } }))) throw new Error('The replacement email index differs from the expected index; inspect it manually.');
  if (!process.argv.includes('--apply')) {
    console.log(`Plan: ${replacement ? 'replacement index already exists' : 'create active_email_unique_v2'}, ${old ? 'remove old email_1 after creation' : 'no old email_1 to remove'}. No changes made.`);
    return;
  }
  if (!replacement) await collection.createIndex({ email: 1, isActive: 1 }, { name: 'active_email_unique_v2', unique: true, partialFilterExpression: { isActive: true, email: { $type: 'string' } } });
  if (old) await collection.dropIndex('email_1');
  console.log('Optional-email index migration completed.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
