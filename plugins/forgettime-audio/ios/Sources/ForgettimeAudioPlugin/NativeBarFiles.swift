import Foundation
import CryptoKit
import Darwin

/// Serialized by the plugin's file queue. A committed directory is the complete library entry.
final class NativeBarFiles {
    static let audioLimit = 64 * 1024 * 1024
    static let sidecarLimit = 2 * 1024 * 1024
    static let pcmLimit = 32 * 1024 * 1024
    static let cacheLimit = 192 * 1024 * 1024
    private let root: URL
    private let library: URL
    private let cache: URL
    private let fm = FileManager.default
    private struct Transfer { let url: URL; let summary: [String: Any]?; let sizes: [String: Int]; var written: [String: Int]; var touched: Date }
    private struct Handle { let url: URL; let size: Int; let owned: Bool; var touched: Date }
    private var transfers: [String: Transfer] = [:]
    private var handles: [String: Handle] = [:]

    init(root: URL) throws {
        self.root = root
        library = root.appendingPathComponent("library", isDirectory: true)
        cache = root.appendingPathComponent("temporary", isDirectory: true)
        try fm.createDirectory(at: library, withIntermediateDirectories: true)
        try Self.excludeFromBackup(root)
        try Self.excludeFromBackup(library)
        // Only this store's uncommitted temporary subtree is cleared on process restart.
        if fm.fileExists(atPath: cache.path) { try fm.removeItem(at: cache) }
        try fm.createDirectory(at: cache, withIntermediateDirectories: true)
        try Self.excludeFromBackup(cache)
    }
    static func excludeFromBackup(_ url: URL) throws {
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var mutable = url; try mutable.setResourceValues(values)
    }
    private func finalURL(_ id: String) -> URL {
        let key = SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
        return library.appendingPathComponent(key, isDirectory: true)
    }
    private func size(_ url: URL, limit: Int) throws -> Int {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let count = values.fileSize, count > 0, count <= limit else { throw FileFailure.invalid("File is missing, empty or exceeds supported limits.") }
        return count
    }
    private func summary(_ value: [String: Any]) throws -> [String: Any] {
        guard Set(value.keys) == Set(["id", "name", "createdAt", "bpm", "complete", "bytes"]),
              let id = value["id"] as? String, !id.isEmpty, id.count <= 128,
              let name = value["name"] as? String, !name.isEmpty, name.count <= 255,
              let created = value["createdAt"] as? NSNumber, created.doubleValue.isFinite, created.doubleValue >= 0,
              let bpm = value["bpm"] as? NSNumber, bpm.doubleValue.isFinite, (30...300).contains(bpm.doubleValue),
              let complete = value["complete"] as? NSNumber, CFGetTypeID(complete) == CFBooleanGetTypeID(),
              let bytes = value["bytes"] as? NSNumber, bytes.doubleValue.rounded() == bytes.doubleValue, bytes.intValue > 0,
              bytes.intValue <= Self.audioLimit + Self.sidecarLimit else { throw FileFailure.invalid("Saved bar summary is invalid.") }
        return value
    }
    private func entry(_ directory: URL) throws -> (summary: [String: Any], wav: Int, sidecar: Int) {
        let manifest = directory.appendingPathComponent("summary.json")
        _ = try size(manifest, limit: 4096)
        guard let object = try JSONSerialization.jsonObject(with: Data(contentsOf: manifest)) as? [String: Any] else { throw FileFailure.invalid("Saved bar manifest is corrupt.") }
        let value = try summary(object)
        let wav = try size(directory.appendingPathComponent("bar.wav"), limit: Self.audioLimit)
        let sidecar = try size(directory.appendingPathComponent("bar.forget"), limit: Self.sidecarLimit)
        guard value["bytes"] as? Int == wav + sidecar, directory.lastPathComponent == finalURL(value["id"] as! String).lastPathComponent else { throw FileFailure.invalid("Saved bar is incomplete or corrupt.") }
        return (value, wav, sidecar)
    }
    func list() throws -> [[String: Any]] {
        let entries = try fm.contentsOfDirectory(at: library, includingPropertiesForKeys: nil)
        guard entries.count <= 100 else { throw FileFailure.invalid("Saved library exceeds 100 bars.") }
        var total = 0
        let values = try entries.map { directory -> [String: Any] in
            let item = try entry(directory); total += item.wav + item.sidecar; return item.summary
        }
        guard total <= 256 * 1024 * 1024 else { throw FileFailure.invalid("Saved library exceeds 256 MiB.") }
        return values
    }
    private func expire() {
        let before = Date().addingTimeInterval(-300)
        for (id, value) in transfers where value.touched < before { abort(transferId: id) }
        for (id, value) in handles where value.touched < before { release(handles: [id]) }
    }
    private func admit(bytes: Int) throws {
        expire()
        let reserved = transfers.values.reduce(0) { $0 + $1.sizes.values.reduce(0, +) }
        let cached = handles.values.filter { $0.owned }.reduce(0) { $0 + $1.size }
        guard transfers.count < 2, handles.count < 8, bytes > 0, reserved + cached + bytes <= Self.cacheLimit else { throw FileFailure.invalid("File processing is busy or temporary storage limit is reached. Try again.") }
    }
    func beginBarSave(summary value: [String: Any], wavBytes: Int, sidecarBytes: Int) throws -> String {
        let value = try summary(value)
        guard wavBytes > 0, wavBytes <= Self.audioLimit, sidecarBytes > 0, sidecarBytes <= Self.sidecarLimit,
              value["bytes"] as? Int == wavBytes + sidecarBytes else { throw FileFailure.invalid("Saved pair sizes are invalid.") }
        let entries = try list(), id = value["id"] as! String
        guard !entries.contains(where: { $0["id"] as? String == id }), !transfers.values.contains(where: { $0.summary?["id"] as? String == id }) else { throw FileFailure.invalid("This saved bar already exists.") }
        let reserved = transfers.values.filter { $0.summary != nil }
        guard entries.count + reserved.count < 100,
              entries.reduce(0, { $0 + ($1["bytes"] as! Int) }) + reserved.reduce(0, { $0 + ($1.summary!["bytes"] as! Int) }) + wavBytes + sidecarBytes <= 256 * 1024 * 1024 else { throw FileFailure.invalid("Saved bars limit reached (100 bars / 256 MiB).") }
        return try begin(summary: value, sizes: ["wav": wavBytes, "sidecar": sidecarBytes])
    }
    private func begin(summary: [String: Any]?, sizes: [String: Int]) throws -> String {
        try admit(bytes: sizes.values.reduce(0, +))
        let id = UUID().uuidString, directory = cache.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: directory, withIntermediateDirectories: false)
        try Self.excludeFromBackup(directory)
        do {
            for part in sizes.keys { try Data().write(to: directory.appendingPathComponent(part)) }
            transfers[id] = Transfer(url: directory, summary: summary, sizes: sizes, written: [:], touched: Date())
            return id
        } catch { try? fm.removeItem(at: directory); throw error }
    }
    func append(transferId: String, part: String, offset: Int, data: Data) throws {
        expire()
        guard var transfer = transfers[transferId], let expected = transfer.sizes[part], offset == (transfer.written[part] ?? 0),
              !data.isEmpty, data.count <= 65536, offset >= 0, offset <= expected - data.count else { throw FileFailure.invalid("File transfer is expired, incomplete or out of order.") }
        let file = try FileHandle(forWritingTo: transfer.url.appendingPathComponent(part))
        defer { try? file.close() }
        try file.seekToEnd(); try file.write(contentsOf: data)
        transfer.written[part] = offset + data.count; transfer.touched = Date(); transfers[transferId] = transfer
    }
    func commit(transferId: String) throws {
        guard let transfer = transfers[transferId], let value = transfer.summary,
              transfer.sizes.allSatisfy({ transfer.written[$0.key] == $0.value }) else { throw FileFailure.invalid("Saved pair is incomplete; no library entry was added.") }
        let final = finalURL(value["id"] as! String)
        guard !fm.fileExists(atPath: final.path) else { throw FileFailure.invalid("This saved bar already exists.") }
        for (part, name) in [("wav", "bar.wav"), ("sidecar", "bar.forget")] {
            let source = transfer.url.appendingPathComponent(part)
            let file = try FileHandle(forWritingTo: source); try file.synchronize(); try file.close()
            try fm.moveItem(at: source, to: transfer.url.appendingPathComponent(name))
        }
        let manifest = transfer.url.appendingPathComponent("summary.json")
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: manifest)
        let file = try FileHandle(forWritingTo: manifest); try file.synchronize(); try file.close()
        try Self.excludeFromBackup(transfer.url)
        try syncDirectory(transfer.url)
        // Same-volume POSIX rename is the single visibility boundary for pair + manifest.
        guard rename(transfer.url.path, final.path) == 0 else { throw FileFailure.invalid("Could not commit saved bar: \(String(cString: strerror(errno))).") }
        transfers.removeValue(forKey: transferId)
        try syncDirectory(library)
    }
    private func syncDirectory(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY)
        guard fd >= 0 else { throw FileFailure.invalid("Could not open storage directory.") }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw FileFailure.invalid("Could not synchronize storage directory.") }
    }
    func abort(transferId: String) {
        if let transfer = transfers.removeValue(forKey: transferId) { try? fm.removeItem(at: transfer.url) }
    }
    private func handle(url: URL, size: Int, owned: Bool, pinned: Bool = false) throws -> [String: Any] {
        expire(); guard handles.count < 8 else { throw FileFailure.invalid("Too many open file handles. Try again.") }
        let id = UUID().uuidString; handles[id] = Handle(url: url, size: size, owned: owned, touched: pinned ? .distantFuture : Date())
        return ["handle": id, "size": size]
    }
    func read(id: String) throws -> [String: Any] {
        let directory = finalURL(id), item = try entry(directory)
        guard handles.count <= 6 else { throw FileFailure.invalid("Too many open files. Try again.") }
        return ["summary": item.summary,
                "wav": try handle(url: directory.appendingPathComponent("bar.wav"), size: item.wav, owned: false),
                "sidecar": try handle(url: directory.appendingPathComponent("bar.forget"), size: item.sidecar, owned: false)]
    }
    func readChunk(handle id: String, offset: Int, length: Int) throws -> Data {
        expire()
        guard var value = handles[id], offset >= 0, length > 0, length <= 65536, offset <= value.size - length else { throw FileFailure.invalid("File handle expired or read exceeds its bounds.") }
        let file = try FileHandle(forReadingFrom: value.url); defer { try? file.close() }
        try file.seek(toOffset: UInt64(offset)); let bytes = try file.read(upToCount: length) ?? Data()
        guard bytes.count == length else { throw FileFailure.invalid("File changed or is incomplete.") }
        value.touched = Date(); handles[id] = value; return bytes
    }
    func beginDecode(name: String, byteLength: Int) throws -> String {
        guard name.count <= 255, name.lowercased().hasSuffix(".m4a"), byteLength > 0, byteLength <= Self.audioLimit else { throw FileFailure.invalid("Choose a supported M4A file within 64 MiB.") }
        return try begin(summary: nil, sizes: ["audio": byteLength])
    }
    func finishDecode(transferId: String) throws -> [String: Any] {
        guard let transfer = transfers[transferId], transfer.summary == nil else { throw FileFailure.invalid("Audio decode transfer is missing.") }
        defer { abort(transferId: transferId) }
        guard transfer.written["audio"] == transfer.sizes["audio"] else { throw FileFailure.invalid("Audio decode upload is incomplete.") }
        try admit(bytes: Self.pcmLimit)
        let output = cache.appendingPathComponent(UUID().uuidString).appendingPathExtension("f32")
        do {
            let result = try NativeAudioFileDecoder.decode(source: transfer.url.appendingPathComponent("audio"), output: output)
            var descriptor = try handle(url: output, size: result.frames * 4, owned: true)
            descriptor["frames"] = result.frames; descriptor["sampleRate"] = result.sampleRate; descriptor["channels"] = result.channels
            return descriptor
        } catch { try? fm.removeItem(at: output); throw error }
    }
    func copySelected(url: URL) throws -> [String: Any] {
        let ext = url.pathExtension.lowercased()
        guard ["wav", "m4a", "forget"].contains(ext), !url.lastPathComponent.isEmpty, url.lastPathComponent.count <= 255 else { throw FileFailure.invalid("Choose one WAV or M4A file, optionally with one .forget file.") }
        let count = try size(url, limit: ext == "forget" ? Self.sidecarLimit : Self.audioLimit)
        try admit(bytes: count)
        let target = cache.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        do {
            let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
            try Data().write(to: target)
            let output = try FileHandle(forWritingTo: target); defer { try? output.close() }
            var total = 0
            while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
                guard total <= count - chunk.count else { throw FileFailure.invalid("Selected file changed or exceeds supported limits.") }
                try output.write(contentsOf: chunk); total += chunk.count
            }
            guard total == count else { throw FileFailure.invalid("Selected file changed or is incomplete.") }
            var value = try handle(url: target, size: total, owned: true)
            value["name"] = url.lastPathComponent
            return value
        } catch { try? fm.removeItem(at: target); throw error }
    }
    func exportPair(id: String) throws -> (urls: [URL], handles: [String]) {
        let directory = finalURL(id), item = try entry(directory)
        try admit(bytes: item.wav + item.sidecar)
        let export = cache.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: export, withIntermediateDirectories: false)
        var ids: [String] = [], urls: [URL] = []
        do {
            for (name, count) in [("bar.wav", item.wav), ("bar.forget", item.sidecar)] {
                let target = export.appendingPathComponent(name)
                try fm.copyItem(at: directory.appendingPathComponent(name), to: target)
                let descriptor = try handle(url: target, size: count, owned: true, pinned: true)
                ids.append(descriptor["handle"] as! String); urls.append(target)
            }
            return (urls, ids)
        } catch { release(handles: ids); try? fm.removeItem(at: export); throw error }
    }
    func release(handles ids: [String]) {
        for id in ids { if let value = handles.removeValue(forKey: id), value.owned { try? fm.removeItem(at: value.url); let parent = value.url.deletingLastPathComponent(); if parent != cache, (try? fm.contentsOfDirectory(atPath: parent.path).isEmpty) == true { try? fm.removeItem(at: parent) } } }
    }
}

enum FileFailure: LocalizedError {
    case invalid(String)
    var errorDescription: String? { switch self { case .invalid(let message): return message } }
}
