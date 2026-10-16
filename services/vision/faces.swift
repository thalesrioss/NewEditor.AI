// Rostos por amostra de tempo, com o Vision do macOS (local, sem API) — ADR-007 I-7.
//
//   swiftc -O services/vision/faces.swift -o services/vision/faces
//   services/vision/faces <video> [passo_s=0.5] [maxLado=640]
//
// Saída (JSON): {"width":W,"height":H,"step":0.5,"frames":[{"t":0.0,"faces":[{"x":0.31,"y":0.12,"w":0.2,"h":0.3,"yaw":0.0,"roll":0.0,"conf":0.98}]}]}
// x,y,w,h normalizados (0–1), origem no canto superior esquerdo.
import AVFoundation
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("uso: faces <video> [passo_s] [maxLado]\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: args[1])
let step = args.count >= 3 ? Double(args[2]) ?? 0.5 : 0.5
let maxSide = args.count >= 4 ? Int(args[3]) ?? 640 : 640

let asset = AVURLAsset(url: url)
let semaphore = DispatchSemaphore(value: 0)
var duration = 0.0
var tracks: [AVAssetTrack] = []
Task {
  duration = (try? await asset.load(.duration).seconds) ?? 0
  tracks = (try? await asset.loadTracks(withMediaType: .video)) ?? []
  semaphore.signal()
}
semaphore.wait()
guard let track = tracks.first else {
  FileHandle.standardError.write("sem vídeo\n".data(using: .utf8)!)
  exit(1)
}
var natural = CGSize(width: 1920, height: 1080)
var transform = CGAffineTransform.identity
let sem2 = DispatchSemaphore(value: 0)
Task {
  natural = (try? await track.load(.naturalSize)) ?? natural
  transform = (try? await track.load(.preferredTransform)) ?? .identity
  sem2.signal()
}
sem2.wait()
// Tamanho exibido (com a rotação do metadado).
let rotated = abs(transform.b) == 1 && abs(transform.c) == 1
let dispW = rotated ? natural.height : natural.width
let dispH = rotated ? natural.width : natural.height

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = CMTime(seconds: step / 2, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: step / 2, preferredTimescale: 600)
let k = Double(maxSide) / max(dispW, dispH)
gen.maximumSize = CGSize(width: dispW * min(1, k), height: dispH * min(1, k))

var frames: [[String: Any]] = []
var t = 0.0
while t < duration {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: time, actualTime: nil) {
    let req = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([req])
    var faces: [[String: Any]] = []
    for obs in req.results ?? [] {
      let b = obs.boundingBox // origem embaixo-esquerda, normalizado
      faces.append([
        "x": Double(b.minX), "y": Double(1 - b.maxY), "w": Double(b.width), "h": Double(b.height),
        "yaw": Double(truncating: obs.yaw ?? 0), "roll": Double(truncating: obs.roll ?? 0), "conf": Double(obs.confidence),
      ])
    }
    frames.append(["t": (t * 1000).rounded() / 1000, "faces": faces])
  } else {
    frames.append(["t": (t * 1000).rounded() / 1000, "faces": []])
  }
  t += step
}
let out: [String: Any] = ["width": Int(dispW), "height": Int(dispH), "step": step, "duration": duration, "frames": frames]
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
