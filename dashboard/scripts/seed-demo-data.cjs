const fs = require("node:fs");
const path = require("node:path");

function readArgs() {
  const args = process.argv.slice(2);
  const options = {
    clear: args.includes("--clear"),
    role: "developer",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--uid") options.uid = args[index + 1];
    if (arg === "--email") options.email = args[index + 1];
    if (arg === "--name") options.displayName = args[index + 1];
    if (arg === "--service-account") options.serviceAccount = args[index + 1];
    if (arg === "--role") options.role = args[index + 1];
  }

  options.uid = options.uid ?? process.env.MOODI_DEMO_UID;
  options.email = options.email ?? process.env.MOODI_DEMO_EMAIL ?? "demo-user@moodi.local";
  options.displayName =
    options.displayName ?? process.env.MOODI_DEMO_NAME ?? "Moodi Demo User";
  options.serviceAccount =
    options.serviceAccount ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    process.env.FIREBASE_SERVICE_ACCOUNT;

  return options;
}

function requireFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch {
    console.error(
      [
        "firebase-admin is not installed yet.",
        "Run this inside the dashboard folder first:",
        "",
        "  npm.cmd install",
        "",
        "Then run the seed command again.",
      ].join("\n")
    );
    process.exit(1);
  }
}

function getServiceAccount(serviceAccountPath) {
  if (!serviceAccountPath) {
    console.error(
      [
        "Missing service account JSON.",
        "Create one in Firebase Console > Project settings > Service accounts > Generate new private key.",
        "Save it locally, for example:",
        "",
        "  dashboard/service-account.moodi-aea62.json",
        "",
        "Then run with:",
        "",
        "  npm.cmd run seed:demo -- --uid YOUR_UID --service-account ./service-account.moodi-aea62.json",
      ].join("\n")
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Service account file was not found: ${resolvedPath}`);
    process.exit(1);
  }

  return require(resolvedPath);
}

function localDateKey(ms) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function atLocalTime(daysAgo, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function minutes(value) {
  return value * 60 * 1000;
}

function buildSites(startedAt, sites) {
  let cursor = startedAt;
  return sites.map((site) => {
    const dwellMs = minutes(site.minutes);
    const visit = {
      url: site.url,
      hostname: new URL(site.url).hostname.replace(/^www\./, ""),
      category: site.category,
      dwellMs,
      startedAt: cursor,
    };
    cursor += dwellMs;
    return visit;
  });
}

function buildSession({ id, uid, daysAgo, hour, minute, tabSwitches, openTabCount, idleMinutes, unfocusedMinutes, sites }) {
  const startedAt = atLocalTime(daysAgo, hour, minute);
  const siteVisits = buildSites(startedAt, sites);
  const totalActiveMs = siteVisits.reduce((total, site) => total + site.dwellMs, 0);
  const idleMs = minutes(idleMinutes);
  const unfocusedMs = minutes(unfocusedMinutes);
  const endedAt = startedAt + totalActiveMs + idleMs + unfocusedMs;
  const categoryBreakdown = siteVisits.reduce((totals, site) => {
    totals[site.category] = (totals[site.category] ?? 0) + site.dwellMs;
    return totals;
  }, {});

  return {
    id,
    uid,
    startedAt,
    endedAt,
    status: "completed",
    endReason: "demo_seed",
    metrics: {
      sessionStartedAt: startedAt,
      tabSwitches,
      openTabCount,
      totalActiveMs,
      idleMs,
      unfocusedMs,
      sites: siteVisits,
      categoryBreakdown,
    },
  };
}

function dominantCategory(categoryBreakdown) {
  const entries = Object.entries(categoryBreakdown);
  if (entries.length === 0) return "none";
  return entries.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function buildDailySummaries(uid, sessions) {
  const summaries = new Map();

  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    const summary =
      summaries.get(date) ??
      {
        id: date,
        date,
        uid,
        totalScreentimeMs: 0,
        totalIdleMs: 0,
        totalUnfocusedMs: 0,
        tabSwitches: 0,
        sessionCount: 0,
        completedSessionCount: 0,
        dominantCategory: "none",
        categoryBreakdown: {},
      };

    summary.totalScreentimeMs += session.metrics.totalActiveMs;
    summary.totalIdleMs += session.metrics.idleMs;
    summary.totalUnfocusedMs += session.metrics.unfocusedMs;
    summary.tabSwitches += session.metrics.tabSwitches;
    summary.sessionCount += 1;
    summary.completedSessionCount += 1;

    for (const [category, value] of Object.entries(session.metrics.categoryBreakdown)) {
      summary.categoryBreakdown[category] = (summary.categoryBreakdown[category] ?? 0) + value;
    }

    summary.dominantCategory = dominantCategory(summary.categoryBreakdown);
    summaries.set(date, summary);
  }

  return [...summaries.values()];
}

function buildDemoSessions(uid) {
  const focusBlocks = [
    [["docs.google.com", "productive", 34], ["scholar.google.com", "reference", 28], ["chatgpt.com", "productive", 18]],
    [["notion.so", "productive", 30], ["github.com", "productive", 24], ["stackoverflow.com", "productive", 16]],
    [["arxiv.org", "reference", 38], ["researchgate.net", "reference", 22], ["docs.google.com", "productive", 20]],
    [["developer.mozilla.org", "reference", 26], ["perplexity.ai", "productive", 22], ["medium.com", "reference", 16]],
  ];
  const mixedBlocks = [
    [["youtube.com", "entertainment", 35], ["reddit.com", "entertainment", 21], ["x.com", "social", 14]],
    [["linkedin.com", "social", 16], ["docs.google.com", "productive", 28], ["wikipedia.org", "reference", 18]],
    [["youtube.com", "entertainment", 22], ["instagram.com", "social", 16], ["notion.so", "productive", 24]],
  ];
  const templates = [];

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const isRecentWeek = daysAgo <= 6;
    const sessionCount = isRecentWeek ? 3 : daysAgo % 2 === 0 ? 2 : 1;
    const baseHours = isRecentWeek ? [9, 14, daysAgo % 3 === 0 ? 23 : 19] : [10, 16];

    for (let index = 0; index < sessionCount; index += 1) {
      const highSwitching = isRecentWeek && index === 2;
      const block =
        highSwitching || (daysAgo + index) % 5 === 0
          ? mixedBlocks[(daysAgo + index) % mixedBlocks.length]
          : focusBlocks[(daysAgo + index) % focusBlocks.length];

      templates.push([
        daysAgo,
        baseHours[index],
        (daysAgo * 7 + index * 13) % 55,
        highSwitching ? 60 + daysAgo : 8 + ((daysAgo + index) % 14),
        highSwitching ? 18 + index : 7 + ((daysAgo + index) % 10),
        index === 1 ? 5 + (daysAgo % 4) : 1 + (daysAgo % 3),
        index === 0 ? 6 + (daysAgo % 5) : 1 + (index % 3),
        block,
      ]);
    }
  }

  return templates.map((template, index) => {
    const [daysAgo, hour, minute, tabSwitches, openTabCount, idleMinutes, unfocusedMinutes, siteRows] = template;
    return buildSession({
      id: `demo-session-${String(index + 1).padStart(2, "0")}`,
      uid,
      daysAgo,
      hour,
      minute,
      tabSwitches,
      openTabCount,
      idleMinutes,
      unfocusedMinutes,
      sites: siteRows.map(([host, category, siteMinutes]) => ({
        url: `https://${host}/demo-${index + 1}`,
        category,
        minutes: siteMinutes,
      })),
    });
  });
}

function buildMoodEntries(uid, admin) {
  const notes = [
    [0, 4, "Focused but slightly tired after research."],
    [1, 3, "Productive day, needed a break later."],
    [3, 2, "Late browsing made it harder to settle down."],
    [5, 4, "Good focus with fewer distractions."],
    [8, 3, "Mixed work and casual browsing."],
  ];

  return notes.map(([daysAgo, score, note], index) => {
    const recordedAt = atLocalTime(daysAgo, 20, 15);
    return {
      id: `demo-mood-${String(index + 1).padStart(2, "0")}`,
      uid,
      score,
      note,
      recordedAt: admin.firestore.Timestamp.fromMillis(recordedAt),
      createdAt: admin.firestore.Timestamp.fromMillis(recordedAt),
      source: "demo_seed",
    };
  });
}

function buildFeedbackEntries(uid, email, displayName, admin) {
  const rows = [
    ["Accuracy", 4, "The stress explanation is easy to understand for screenshots."],
    ["UI", 5, "The glass-style dashboard feels polished and consistent."],
    ["Suggestion", 4, "The break reminders could include more focus-specific actions."],
  ];

  return rows.map(([type, rating, message], index) => ({
    id: `demo-feedback-${uid}-${index + 1}`,
    uid,
    email,
    displayName,
    type,
    rating,
    message,
    appVersion: "v1.0.0",
    source: "demo_seed",
    createdAt: admin.firestore.Timestamp.fromMillis(atLocalTime(index, 16, 20)),
  }));
}

async function deleteDemoCollectionDocs(collectionRef) {
  const snapshot = await collectionRef.get();
  const batch = collectionRef.firestore.batch();
  let count = 0;

  snapshot.docs.forEach((docSnapshot) => {
    if (docSnapshot.id.startsWith("demo-")) {
      batch.delete(docSnapshot.ref);
      count += 1;
    }
  });

  if (count > 0) await batch.commit();
  return count;
}

async function clearDemoData(db, uid) {
  const userRef = db.collection("users").doc(uid);
  const sessionsDeleted = await deleteDemoCollectionDocs(userRef.collection("sessions"));
  const summariesDeleted = await deleteDemoCollectionDocs(userRef.collection("dailySummaries"));
  const moodsDeleted = await deleteDemoCollectionDocs(userRef.collection("moodEntries"));

  const feedbackSnapshot = await db
    .collection("feedback")
    .where("uid", "==", uid)
    .where("source", "==", "demo_seed")
    .get();
  const feedbackBatch = db.batch();
  feedbackSnapshot.docs.forEach((docSnapshot) => feedbackBatch.delete(docSnapshot.ref));
  if (!feedbackSnapshot.empty) await feedbackBatch.commit();

  console.log(
    `Cleared demo data: ${sessionsDeleted} sessions, ${summariesDeleted} summaries, ${moodsDeleted} mood entries, ${feedbackSnapshot.size} feedback entries.`
  );
}

async function seedDemoData(db, admin, options) {
  const { uid, email, displayName, role } = options;
  const userRef = db.collection("users").doc(uid);
  const sessions = buildDemoSessions(uid);
  const summaries = buildDailySummaries(uid, sessions);
  const moodEntries = buildMoodEntries(uid, admin);
  const feedbackEntries = buildFeedbackEntries(uid, email, displayName, admin);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await clearDemoData(db, uid);

  let batch = db.batch();
  let writes = 0;
  const commitIfNeeded = async () => {
    if (writes === 0) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  const set = async (ref, data) => {
    batch.set(ref, data, { merge: true });
    writes += 1;
    if (writes >= 450) await commitIfNeeded();
  };

  await set(userRef, {
    uid,
    email,
    displayName,
    role: role === "developer" ? "developer" : "user",
    photoURL: "",
    demoSeededAt: now,
    lastLoginAt: now,
  });

  for (const session of sessions) {
    await set(userRef.collection("sessions").doc(session.id), {
      ...session,
      createdAt: admin.firestore.Timestamp.fromMillis(session.startedAt),
      updatedAt: admin.firestore.Timestamp.fromMillis(session.endedAt),
    });
  }

  for (const summary of summaries) {
    const { id, ...summaryData } = summary;
    await set(userRef.collection("dailySummaries").doc(`demo-${summary.id}`), {
      ...summaryData,
      updatedAt: now,
    });
  }

  for (const entry of moodEntries) {
    await set(userRef.collection("moodEntries").doc(entry.id), entry);
  }

  for (const entry of feedbackEntries) {
    await set(db.collection("feedback").doc(entry.id), entry);
  }

  await commitIfNeeded();

  console.log(
    [
      "Seeded Moodi demo data.",
      `User: ${uid}`,
      `Sessions: ${sessions.length}`,
      `Daily summaries: ${summaries.length}`,
      `Mood entries: ${moodEntries.length}`,
      `Feedback entries: ${feedbackEntries.length}`,
      "",
      "Open or refresh the dashboard to see screenshot-ready data.",
    ].join("\n")
  );
}

async function main() {
  const options = readArgs();

  if (!options.uid) {
    console.error(
      [
        "Missing Firebase Auth UID.",
        "Find it in Firebase Console > Authentication > Users.",
        "",
        "Example:",
        "  npm.cmd run seed:demo -- --uid YOUR_UID --service-account ./service-account.moodi-aea62.json",
      ].join("\n")
    );
    process.exit(1);
  }

  const admin = requireFirebaseAdmin();
  const serviceAccount = getServiceAccount(options.serviceAccount);

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const db = admin.firestore();

  if (options.clear) {
    await clearDemoData(db, options.uid);
  } else {
    await seedDemoData(db, admin, options);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
