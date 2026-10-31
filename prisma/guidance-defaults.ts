import { readFile } from "node:fs/promises";
import type { PrismaClient } from "./generated/client";
import { defaultFuelReturnNotice, FUEL_NOTICE_LEVELS, type FuelNoticeLevel, type FuelNoticePhase } from "../lib/fuel-return-notice";
import { FUEL_THANK_YOU_DEFAULT_MESSAGE } from "../lib/fuel-thank-you";
import { defaultParkingGuidanceSetting, PARKING_GUIDANCE_EVENTS, type ParkingGuidanceEvent } from "../lib/parking-guidance";

type AudioSample = { fileName: string; mime: "audio/mpeg" | "audio/wav" };

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
    data: await readFile(new URL(`../public/audio/${sample.fileName}`, import.meta.url)),
    mime: sample.mime,
    name: sample.fileName,
  };
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
