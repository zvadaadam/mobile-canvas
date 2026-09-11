import Foundation

nonisolated private struct CanvasRuntimeFailure: Decodable {
  nonisolated struct Detail: Decodable { let message: String }
  let error: Detail
}

/// One connection owner for the native shell. Requests are cancellable and never
/// retried implicitly: an uncertain mutation must not execute a second time.
@MainActor
final class CanvasRuntimeClient {
  let baseURL: URL?
  private let session: URLSession
  private var requests: [UUID: Task<Void, Never>] = [:]

  init(url: URL?, session: URLSession = .shared) {
    baseURL = Self.loopbackURL(url)
    self.session = session
  }

  nonisolated static func loopbackURL(_ url: URL?) -> URL? {
    guard let url, url.scheme == "http", url.host == "127.0.0.1", let port = url.port,
      (1...65535).contains(port), url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else { return nil }
    return url
  }

  isolated deinit { for request in requests.values { request.cancel() } }

  func cancelAll() {
    for request in requests.values { request.cancel() }
    requests.removeAll()
  }

  func request<Response: Decodable & Sendable>(_ path: String, body: [String: Any]? = nil,
    as type: Response.Type, completion: @escaping @MainActor (Result<Response, Error>) -> Void) {
    guard let baseURL, let url = URL(string: "api/\(path)", relativeTo: baseURL.appendingPathComponent(""))?.absoluteURL,
      url.host == baseURL.host, url.port == baseURL.port else {
      completion(.failure(CanvasProtocolError.invalid("Open a project with its loopback runtime URL.")))
      return
    }
    var call = URLRequest(url: url)
    call.timeoutInterval = 3
    do {
      if let body {
        call.httpMethod = "POST"
        call.setValue("application/json", forHTTPHeaderField: "Content-Type")
        call.httpBody = try JSONSerialization.data(withJSONObject: body)
      }
    } catch { completion(.failure(error)); return }
    let id = UUID()
    requests[id] = Task { [weak self, session] in
      let result: Result<Response, Error>
      do { result = .success(try await Self.perform(call, session: session, as: type, path: path)) }
      catch { result = .failure(error) }
      guard !Task.isCancelled else { return }
      self?.requests.removeValue(forKey: id)
      completion(result)
    }
  }

  // Explicitly leave the UI executor for decoding, even when an imported
  // Swift target enables MainActor-by-default / approachable concurrency.
  @concurrent private static func perform<Response: Decodable & Sendable>(_ call: URLRequest,
    session: URLSession, as type: Response.Type, path: String) async throws -> Response {
    let (data, response) = try await session.data(for: call)
    try Task.checkCancellation()
    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
      let message = (try? JSONDecoder().decode(CanvasRuntimeFailure.self, from: data))?.error.message ?? "Canvas request failed."
      throw NSError(domain: "CanvasRuntime", code: (response as? HTTPURLResponse)?.statusCode ?? 0,
        userInfo: [NSLocalizedDescriptionKey: message])
    }
    do { return try JSONDecoder().decode(type, from: data) }
    catch { throw CanvasProtocolError.invalid("\(path): \(error.localizedDescription)") }
  }

  /// Unstructured props, source and setup responses remain at the integration boundary.
  func request(_ path: String, body: [String: Any]? = nil,
    completion: @escaping @MainActor (Result<[String: Any], Error>) -> Void) {
    request(path, body: body, as: [String: CanvasJSON].self) { result in
      completion(result.map { $0.mapValues(\.foundation) })
    }
  }
}
