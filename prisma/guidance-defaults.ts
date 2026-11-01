import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Prisma, PrismaClient } from "./generated/client";
import { defaultFuelReturnNotice, FUEL_NOTICE_LEVELS, type FuelNoticeLevel, type FuelNoticePhase } from "../lib/fuel-return-notice";
import { FUEL_THANK_YOU_DEFAULT_MESSAGE } from "../lib/fuel-thank-you";
import { defaultParkingGuidanceSetting, PARKING_GUIDANCE_EVENTS, type ParkingGuidanceEvent } from "../lib/parking-guidance";

type AudioSample = { fileName: string; mime: "audio/mpeg" | "audio/wav" };
type GuidanceDb = PrismaClient | Prisma.TransactionClient;

const audioSamples = {
  parkingBlocked: { fileName: "parking-blocked-warning.mp3", mime: "audio/mpeg" },
  fuelReturnLow: { fileName: "fuel-return-low-reminder.wav", mime: "audio/wav" },
  fuelReturnEmpty: { fileName: "fuel-return-empty-reminder.mp3", mime: "audio/mpeg" },
  fuelThankYou: { fileName: "fuel-refueled-thank-you.wav", mime: "audio/wav" },
} satisfies Record<string, AudioSample>;

export const guidanceDefaultAudioFiles = Object.values(audioSamples).map((item) => item.fileName);

const parkingMessageOverrides: Partial<Record<ParkingGuidanceEvent, string>> = {
  BLOCKED_OUT: "手前に車があるため出庫できません。",
  BLOCKED_IN: "手前に車があるため入庫できません。",
};

const fuelMessageOverrides: Partial<Record<`${FuelNoticePhase}:${FuelNoticeLevel}`, string>> = {
  "RETURN:0": "ガソリンがほとんどありません。次回から、給油してから返却をお願いします。",
};

async function loadAudio(sample: AudioSample) {
  return {
    data: await readFile(resolve(process.cwd(), "public", "audio", sample.fileName)),
    mime: sample.mime,
    name: sample.fileName,
  };
}

async function createAudio(db: GuidanceDb, sample: AudioSample) {
  return db.noticeAudio.create({ data: await loadAudio(sample), select: { id: true } });
}

async function deleteUnusedAudio(db: GuidanceDb) {
  await db.noticeAudio.deleteMany({ where: { fuelReturnNotice: null, fuelStartNotice: null, fuelThankYouSetting: null, parkingGuidanceSetting: null } });
}

async function createParkingDefaults(prisma: PrismaClient) {
  for (const event of PARKING_GUIDANCE_EVENTS) {
    if (await prisma.parkingGuidanceSetting.findUnique({ where: { event }, select: { event: true } })) continue;
    const setting = defaultParkingGuidanceSetting(event);
    const sample = event === "BLOCKED_OUT" || event === "BLOCKED_IN" ? audioSamples.parkingBlocked : null;
    await prisma.parkingGuidanceSetting.create({
      data: {
        event,
        enabled: setting.enabled,
        message: parkingMessageOverrides[event] ?? setting.message,
        ...(sample ? { audio: { create: await loadAudio(sample) } } : {}),
      },
    });
  }
}

async function createFuelDefaults(prisma: PrismaClient, phase: FuelNoticePhase) {
  for (const level of FUEL_NOTICE_LEVELS) {
    const exists = phase === "START"
      ? await prisma.fuelStartNotice.findUnique({ where: { level }, select: { level: true } })
      : await prisma.fuelReturnNotice.findUnique({ where: { level }, select: { level: true } });
    if (exists) continue;
    const setting = defaultFuelReturnNotice(level, phase);
    const sample = phase === "RETURN" ? level === 1 ? audioSamples.fuelReturnLow : level === 0 ? audioSamples.fuelReturnEmpty : null : null;
    const common = {
      level,
      displayMode: setting.displayMode,
      enabled: setting.enabled,
      animated: setting.animated,
      audioEnabled: setting.audioEnabled,
      message: fuelMessageOverrides[`${phase}:${level}`] ?? setting.message,
      ...(sample ? { audio: { create: await loadAudio(sample) } } : {}),
    };
    if (phase === "START") await prisma.fuelStartNotice.create({ data: common });
    else await prisma.fuelReturnNotice.create({ data: { ...common, parkingAnimationEnabled: setting.parkingAnimationEnabled, parkingAnimationRefueledOnly: setting.parkingAnimationRefueledOnly } });
  }
}

async function createFuelThankYouDefault(prisma: PrismaClient) {
  if (await prisma.fuelThankYouSetting.findUnique({ where: { id: "default" }, select: { id: true } })) return;
  await prisma.fuelThankYouSetting.create({
    data: {
      id: "default",
      enabled: true,
      audioEnabled: true,
      message: FUEL_THANK_YOU_DEFAULT_MESSAGE,
      audio: { create: await loadAudio(audioSamples.fuelThankYou) },
    },
  });
}

// 新規DBにだけ実運用向けの初期値とサンプル音声を登録する。
// 設定行がすでにある場合は、利用者が変更・削除した音声を上書きしない。
export async function seedGuidanceDefaults(prisma: PrismaClient) {
  await createParkingDefaults(prisma);
  await createFuelDefaults(prisma, "START");
  await createFuelDefaults(prisma, "RETURN");
  await createFuelThankYouDefault(prisma);
}

export async function resetParkingGuidanceDefaults(db: GuidanceDb) {
  for (const event of PARKING_GUIDANCE_EVENTS) {
    const setting = defaultParkingGuidanceSetting(event);
    const sample = event === "BLOCKED_OUT" || event === "BLOCKED_IN" ? audioSamples.parkingBlocked : null;
    const audioId = sample ? (await createAudio(db, sample)).id : null;
    const data = { enabled: setting.enabled, message: parkingMessageOverrides[event] ?? setting.message, audioId };
    await db.parkingGuidanceSetting.upsert({
      where: { event },
      create: { event, ...data },
      update: { ...data, version: { increment: 1 } },
    });
  }
  await deleteUnusedAudio(db);
}

export async function resetFuelNoticeDefaults(db: GuidanceDb, phase: FuelNoticePhase) {
  for (const level of FUEL_NOTICE_LEVELS) {
    const setting = defaultFuelReturnNotice(level, phase);
    const sample = phase === "RETURN" ? level === 1 ? audioSamples.fuelReturnLow : level === 0 ? audioSamples.fuelReturnEmpty : null : null;
    const audioId = sample ? (await createAudio(db, sample)).id : null;
    const common = {
      displayMode: setting.displayMode,
      enabled: setting.enabled,
      animated: setting.animated,
      audioEnabled: setting.audioEnabled,
      message: fuelMessageOverrides[`${phase}:${level}`] ?? setting.message,
      audioId,
    };
    if (phase === "START") {
      await db.fuelStartNotice.upsert({ where: { level }, create: { level, ...common }, update: { ...common, version: { increment: 1 } } });
    } else {
      const data = { ...common, parkingAnimationEnabled: setting.parkingAnimationEnabled, parkingAnimationRefueledOnly: setting.parkingAnimationRefueledOnly };
      await db.fuelReturnNotice.upsert({ where: { level }, create: { level, ...data }, update: { ...data, version: { increment: 1 } } });
    }
  }
  await deleteUnusedAudio(db);
}

export async function resetFuelThankYouDefault(db: GuidanceDb) {
  const audioId = (await createAudio(db, audioSamples.fuelThankYou)).id;
  const data = { enabled: true, audioEnabled: true, message: FUEL_THANK_YOU_DEFAULT_MESSAGE, audioId };
  await db.fuelThankYouSetting.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: { ...data, version: { increment: 1 } },
  });
  await deleteUnusedAudio(db);
}
