import { describe, it, expect } from 'vitest';
import { openDb, type Db } from './db.ts';
import { listMachines, getMachine } from './api-machines.ts';

function mem(): Db {
  return openDb(':memory:');
}

function insertMachine(
  db: Db,
  id: string,
  over: { name?: string; grp?: string; cat?: string | null; status?: string; sort?: number } = {},
): void {
  const m = { name: id.toUpperCase(), grp: 'A', cat: null, status: 'ok', sort: 0, ...over };
  db.prepare('INSERT INTO machines(id,name,grp,cat,status,sort) VALUES(?,?,?,?,?,?)').run(
    id,
    m.name,
    m.grp,
    m.cat,
    m.status,
    m.sort,
  );
}

const url = (query = ''): URL => new URL('http://x/api/v1/machines' + query);

describe('listMachines', () => {
  it('returns every machine, wire-shaped, in DB order (sort, name)', () => {
    const db = mem();
    insertMachine(db, 'b', { name: 'Beta', sort: 1 });
    insertMachine(db, 'a', { name: 'Alpha', sort: 0 });
    const res = listMachines(db, url());
    expect(res.status).toBe(200);
    expect((res.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('is an empty array, not an error, when there are no machines', () => {
    const res = listMachines(mem(), url());
    expect(res).toEqual({ status: 200, body: { data: [] } });
  });

  it('filters by category, treating a missing cat as maschine', () => {
    const db = mem();
    insertMachine(db, 'a', { cat: null });
    insertMachine(db, 'b', { cat: 'messtechnik' });
    const maschinen = listMachines(db, url('?category=maschine'));
    expect((maschinen.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['a']);
    const messtechnik = listMachines(db, url('?category=messtechnik'));
    expect((messtechnik.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['b']);
  });

  it('filters by group', () => {
    const db = mem();
    insertMachine(db, 'a', { grp: 'Halle 1' });
    insertMachine(db, 'b', { grp: 'Halle 2' });
    const res = listMachines(db, url('?group=Halle+2'));
    expect((res.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['b']);
  });

  it('filters by status', () => {
    const db = mem();
    insertMachine(db, 'a', { status: 'ok' });
    insertMachine(db, 'b', { status: 'defekt' });
    const res = listMachines(db, url('?status=defekt'));
    expect((res.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['b']);
  });

  it('sorts by name (German collation) when ?sort=name is given', () => {
    const db = mem();
    insertMachine(db, 'a', { name: 'Zebra', sort: 0 });
    insertMachine(db, 'b', { name: 'Amboss', sort: 1 });
    const res = listMachines(db, url('?sort=name'));
    expect((res.body as { data: { name: string }[] }).data.map((m) => m.name)).toEqual([
      'Amboss',
      'Zebra',
    ]);
  });

  it('combines filters (category AND group)', () => {
    const db = mem();
    insertMachine(db, 'a', { grp: 'Halle 1', cat: null });
    insertMachine(db, 'b', { grp: 'Halle 1', cat: 'messtechnik' });
    insertMachine(db, 'c', { grp: 'Halle 2', cat: null });
    const res = listMachines(db, url('?category=maschine&group=Halle+1'));
    expect((res.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['a']);
  });
});

describe('getMachine', () => {
  it('returns the wire-shaped machine when it exists', () => {
    const db = mem();
    insertMachine(db, 'a', { name: 'Alpha' });
    const res = getMachine(db, 'a');
    expect(res.status).toBe(200);
    expect((res.body as { data: { id: string; name: string } }).data).toMatchObject({
      id: 'a',
      name: 'Alpha',
    });
  });

  it('is a 404 NOT_FOUND with the id in the message when it does not exist', () => {
    const res = getMachine(mem(), 'ghost');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect((res.body as { error: string }).error).toContain('ghost');
  });
});
