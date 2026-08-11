const { createClient } = require('@supabase/supabase-js');

// Connect to Supabase using Environment Variables
const supabaseUrl = process.env.SUPABASE_URL || 'https://mximtapakqpjmkcupxay.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_-kjbxfBV2emYaalQYLy3gg_ITzG9giQ';
const supabase = createClient(supabaseUrl, supabaseKey);

// Read all records from a table
async function readAll(tableName) {
  const { data, error } = await supabase.from(tableName).select('*');
  if (error) {
    console.error(`Error reading ${tableName}:`, error);
    return [];
  }
  return data;
}

// Insert a new record
async function insert(tableName, record) {
  const { data, error } = await supabase.from(tableName).insert([record]).select();
  if (error) throw error;
  return { returnValue: data[0] };
}

// Update an existing record
async function update(tableName, id, patch) {
  const { data, error } = await supabase.from(tableName).update(patch).eq('id', id).select();
  if (error) throw error;
  return { returnValue: data[0] };
}

// Delete a record
async function remove(tableName, id) {
  const { error } = await supabase.from(tableName).delete().eq('id', id);
  if (error) throw error;
  return { returnValue: true };
}

// Find a single record by ID
async function findById(tableName, id) {
  const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

module.exports = { readAll, insert, update, remove, findById, supabase };