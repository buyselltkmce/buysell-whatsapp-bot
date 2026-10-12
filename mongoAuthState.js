import { initAuthCreds, BufferJSON, proto } from 'baileys';

/**
 * Baileys auth state stored in MongoDB.
 *
 * Render's free tier has no persistent disk, so the default file-based auth
 * would be wiped on every restart/redeploy and you'd have to re-link WhatsApp.
 * Storing creds + signal keys in Mongo means you only link once.
 *
 * Values are stored as JSON strings (via BufferJSON) because the signal key
 * objects contain Buffers and keys that MongoDB can't store directly.
 */
export async function useMongoAuthState(collection) {
  const writeData = (id, data) =>
    collection.replaceOne(
      { _id: id },
      { _id: id, value: JSON.stringify(data, BufferJSON.replacer), updatedAt: new Date() },
      { upsert: true }
    );

  const readData = async (id) => {
    const doc = await collection.findOne({ _id: id });
    return doc ? JSON.parse(doc.value, BufferJSON.reviver) : null;
  };

  const removeData = (id) => collection.deleteOne({ _id: id });

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData('creds', creds)
  };
}
