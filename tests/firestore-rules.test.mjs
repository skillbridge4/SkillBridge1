import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

let environment;
const company = {
  id: 'test-company',
  name: 'Test Company',
  sector: 'Software',
  type: 'Startup',
  city: null,
  state: null,
  website: null,
  careersUrl: null,
  logo: null,
  verified: false,
  lastVerified: '2026-11-10'
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-skillbridge',
    firestore: {
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
    }
  });
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'companies/test-company'), company);
    await setDoc(doc(context.firestore(), 'admins/admin-user'), { uid: 'admin-user' });
    await setDoc(doc(context.firestore(), 'certificates/test-cert'), {
      certId: 'test-cert',
      uid: 'certificate-owner',
      status: 'valid'
    });
  });
});

after(async () => environment?.cleanup());

test('catalog is publicly readable', async () => {
  await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), 'companies/test-company')));
});

test('catalog writes require an admin', async () => {
  await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), 'companies/other'), {
    ...company,
    id: 'other'
  }));
});

test('an authenticated user cannot self-promote to admin', async () => {
  await assertFails(setDoc(doc(environment.authenticatedContext('student').firestore(), 'admins/student'), {
    uid: 'student'
  }));
});

test('admin can write a valid company but invalid types are rejected', async () => {
  const db = environment.authenticatedContext('admin-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'companies/allowed'), { ...company, id: 'allowed' }));
  await assertFails(setDoc(doc(db, 'companies/invalid'), { ...company, id: 'invalid', type: 'Unknown' }));
});

test('users can only access their own profile documents', async () => {
  const student = environment.authenticatedContext('student').firestore();
  await assertSucceeds(setDoc(doc(student, 'users/student'), { name: 'Student' }));
  await assertFails(setDoc(doc(student, 'users/other'), { name: 'Other' }));
});

test('watched video documents are private to the owning user', async () => {
  const student = environment.authenticatedContext('student').firestore();
  await assertSucceeds(setDoc(doc(student, 'users/student/watchedVideos/prep-001'), {
    id: 'prep-001',
    watched: true
  }));
  await assertFails(setDoc(doc(student, 'users/other/watchedVideos/prep-001'), {
    id: 'prep-001',
    watched: true
  }));
});

test('AI guidance documents are readable and writable only by their owner', async () => {
  const owner = environment.authenticatedContext('student').firestore();
  const other = environment.authenticatedContext('other-student').firestore();
  const ownerDoc = doc(owner, 'users/student/aiGuidance/roadmap');
  const otherDoc = doc(other, 'users/student/aiGuidance/roadmap');
  await assertSucceeds(setDoc(ownerDoc, {
    result: { roadmap: [{ week: 1, goal: 'Learn' }] },
    completedWeeks: []
  }));
  await assertSucceeds(getDoc(ownerDoc));
  await assertFails(getDoc(otherDoc));
  await assertFails(setDoc(otherDoc, { result: {} }));
  await assertSucceeds(deleteDoc(ownerDoc));
});

test('certificate owners can read their own certificate, but other users and public users cannot', async () => {
  const owner = environment.authenticatedContext('certificate-owner').firestore();
  const otherUser = environment.authenticatedContext('another-student').firestore();
  const publicDb = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(owner, 'certificates/test-cert')));
  await assertFails(getDoc(doc(otherUser, 'certificates/test-cert')));
  await assertFails(getDoc(doc(publicDb, 'certificates/test-cert')));
});

test('clients cannot write or list certificates', async () => {
  const owner = environment.authenticatedContext('certificate-owner').firestore();
  const publicDb = environment.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(owner, 'certificates/client-created'), {
    certId: 'client-created',
    uid: 'certificate-owner',
    status: 'valid'
  }));
  await assertFails(getDocs(collection(publicDb, 'certificates')));
  await assertFails(setDoc(doc(owner, 'pathQuizResults/forged-result'), {
    uid: 'certificate-owner',
    passed: true,
    score: 100
  }));
  await assertFails(setDoc(doc(owner, 'apiRateLimits/forged-limit'), {
    timestamps: []
  }));
  await assertFails(getDoc(doc(owner, 'apiRateLimits/forged-limit')));
});
