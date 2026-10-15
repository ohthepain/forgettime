import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

/// UIKit picker/share at the edge; all bounded file and codec work runs on one serial queue.
final class NativeFilesController: NSObject, UIDocumentPickerDelegate {
    private let queue = DispatchQueue(label: "app.forgettime.files", qos: .userInitiated)
    private lazy var storage: Result<NativeBarFiles, Error> = Result {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try NativeBarFiles(root: support.appendingPathComponent("ForgettimeBarFiles", isDirectory: true))
    }
    private var pickerCall: CAPPluginCall?
    private var picker: UIDocumentPickerViewController?
    private var sharing = false

    func perform(_ call: CAPPluginCall, _ operation: @escaping (NativeBarFiles) throws -> [String: Any]) {
        queue.async {
            do { let value = try operation(self.storage.get()); call.resolve(value) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    func pick(_ call: CAPPluginCall, presenter: UIViewController?) {
        DispatchQueue.main.async {
            guard let presenter = presenter, presenter.presentedViewController == nil, self.pickerCall == nil, !self.sharing,
                  UIApplication.shared.applicationState != .background else { call.reject("Close the current chooser and open the app before importing."); return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio, .data], asCopy: true)
            picker.allowsMultipleSelection = true
            picker.delegate = self
            self.pickerCall = call; self.picker = picker
            presenter.present(picker, animated: true)
        }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard controller === picker else { return }
        pickerCall?.resolve(["files": []]); pickerCall = nil; picker = nil
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard controller === picker, let call = pickerCall else { return }
        queue.async {
            var descriptors: [[String: Any]] = []
            do {
                guard !urls.isEmpty, urls.count <= 2 else { throw FileFailure.invalid("Choose one WAV or M4A file, optionally with one .forget file.") }
                let store = try self.storage.get()
                for url in urls {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    var coordinationError: NSError?
                    var copied: Result<[String: Any], Error>?
                    NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { selected in
                        copied = Result { try store.copySelected(url: selected) }
                    }
                    if let error = coordinationError { throw error }
                    guard let result = copied else { throw FileFailure.invalid("The selected file provider could not supply the file.") }
                    descriptors.append(try result.get())
                }
                call.resolve(["files": descriptors])
            } catch {
                if let store = try? self.storage.get() { store.release(handles: descriptors.compactMap { $0["handle"] as? String }) }
                call.reject("Unable to import selected files: \(error.localizedDescription)")
            }
            DispatchQueue.main.async { self.pickerCall = nil; self.picker = nil }
        }
    }
    func export(_ call: CAPPluginCall, presenter: UIViewController?) {
        DispatchQueue.main.async {
            guard let presenter = presenter, presenter.presentedViewController == nil, !self.sharing, self.pickerCall == nil,
                  UIApplication.shared.applicationState != .background, let id = call.getString("id") else { call.reject("Close the current chooser and open the app before sharing."); return }
            self.sharing = true
            self.queue.async {
                do {
                    let store = try self.storage.get(), pair = try store.exportPair(id: id)
                    DispatchQueue.main.async {
                        guard presenter.presentedViewController == nil, UIApplication.shared.applicationState != .background else {
                            self.queue.async { store.release(handles: pair.handles) }; self.sharing = false
                            call.reject("Sharing was interrupted before the chooser opened."); return
                        }
                        let activity = UIActivityViewController(activityItems: pair.urls, applicationActivities: nil)
                        activity.completionWithItemsHandler = { _, completed, _, error in
                            self.queue.async { store.release(handles: pair.handles) }
                            self.sharing = false
                            if let error = error { call.reject(error.localizedDescription) }
                            else { call.resolve(["status": completed ? "presented" : "cancelled"]) }
                        }
                        if let popover = activity.popoverPresentationController {
                            popover.sourceView = presenter.view
                            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                            popover.permittedArrowDirections = []
                        }
                        presenter.present(activity, animated: true)
                    }
                } catch { DispatchQueue.main.async { self.sharing = false; call.reject(error.localizedDescription) } }
            }
        }
    }
}

extension ForgettimeAudioPlugin {
    private func fileInteger(_ call: CAPPluginCall, _ key: String) throws -> Int {
        guard let value = call.getDouble(key), value.isFinite, value.rounded() == value, value >= 0, value <= Double(Int32.max) else { throw FileFailure.invalid("Invalid file size or offset.") }
        return Int(value)
    }
    @objc public func listSavedBars(_ call: CAPPluginCall) { fileController.perform(call) { ["bars": try $0.list()] } }
    @objc public func beginBarSave(_ call: CAPPluginCall) {
        fileController.perform(call) { store in
            guard let summary = call.getObject("summary") else { throw FileFailure.invalid("Saved bar summary is missing.") }
            return ["transferId": try store.beginBarSave(summary: summary, wavBytes: self.fileInteger(call, "wavBytes"), sidecarBytes: self.fileInteger(call, "sidecarBytes"))]
        }
    }
    @objc public func appendFileChunk(_ call: CAPPluginCall) {
        fileController.perform(call) { store in
            guard let id = call.getString("transferId"), let part = call.getString("part"), let text = call.getString("data"), text.utf8.count <= 87384,
                  let bytes = Data(base64Encoded: text) else { throw FileFailure.invalid("Invalid file transfer chunk.") }
            try store.append(transferId: id, part: part, offset: self.fileInteger(call, "offset"), data: bytes); return [:]
        }
    }
    @objc public func commitBarSave(_ call: CAPPluginCall) { fileController.perform(call) { try $0.commit(transferId: call.getString("transferId") ?? ""); return [:] } }
    @objc public func abortFileTransfer(_ call: CAPPluginCall) { fileController.perform(call) { $0.abort(transferId: call.getString("transferId") ?? ""); return [:] } }
    @objc public func readSavedBar(_ call: CAPPluginCall) { fileController.perform(call) { try $0.read(id: call.getString("id") ?? "") } }
    @objc public func readFileChunk(_ call: CAPPluginCall) {
        fileController.perform(call) { store in
            ["data": try store.readChunk(handle: call.getString("handle") ?? "", offset: self.fileInteger(call, "offset"), length: self.fileInteger(call, "length")).base64EncodedString()]
        }
    }
    @objc public func releaseFiles(_ call: CAPPluginCall) { fileController.perform(call) { $0.release(handles: call.getArray("handles", String.self) ?? []); return [:] } }
    @objc public func beginAudioDecode(_ call: CAPPluginCall) {
        fileController.perform(call) { ["transferId": try $0.beginDecode(name: call.getString("name") ?? "", byteLength: self.fileInteger(call, "byteLength"))] }
    }
    @objc public func finishAudioDecode(_ call: CAPPluginCall) { fileController.perform(call) { try $0.finishDecode(transferId: call.getString("transferId") ?? "") } }
    @objc public func pickAudioFiles(_ call: CAPPluginCall) { fileController.pick(call, presenter: bridge?.viewController) }
    @objc public func exportSavedBar(_ call: CAPPluginCall) { fileController.export(call, presenter: bridge?.viewController) }
}
