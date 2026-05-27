import SwiftUI
import MapKit
import CoreLocation
import Combine

private enum AppTab {
    case map
    case qr
    case account
}

private struct ToiletFeatures {
    let women: String
    let men: String
    let accessible: String
    let neutral: String
}

private struct ToiletHours {
    let today: String
    let sat: String
    let sun: String
}

private struct Toilet: Identifiable {
    let id: String
    let name: String
    let area: String
    let latitude: Double
    let longitude: Double
    let paid: Bool
    let comment: String
    let features: ToiletFeatures
    let hours: ToiletHours

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

@MainActor
private final class ToiletsViewModel: ObservableObject {
    private static let initialRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 51.4974, longitude: -0.1751),
        span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
    )

    @Published var cameraPosition: MapCameraPosition = .region(
        ToiletsViewModel.initialRegion
    )
    @Published var searchText = ""
    @Published var statusText = "Loading toilets data..."
    @Published var selectedToilet: Toilet?
    @Published private(set) var visibleToilets: [Toilet] = []

    private let dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    private let markerLimit = 1000
    private let todayDayIndex = (Calendar.current.component(.weekday, from: Date()) + 5) % 7

    private var allToilets: [Toilet] = []
    private var filteredToilets: [Toilet] = []
    private var accessibleOnly = false
    private var hiddenByLimit = 0
    private var currentRegion: MKCoordinateRegion?
    private var loaded = false

    var isAccessibleOnly: Bool {
        accessibleOnly
    }

    func loadDataIfNeeded() {
        guard !loaded else { return }
        loaded = true
        currentRegion = ToiletsViewModel.initialRegion

        if let bundleToilets = loadToiletsFromBundle(), !bundleToilets.isEmpty {
            allToilets = bundleToilets
            statusText = "Loaded \(bundleToilets.count) toilets from local dataset."
        } else {
            allToilets = fallbackToilets
            statusText = "Could not load CSV dataset. Showing sample toilets instead."
        }

        applyFilters()
    }

    func onMapRegionChanged(_ region: MKCoordinateRegion) {
        currentRegion = region
        refreshVisibleToilets()
        updateStatusText()
    }

    func onSearchTextChanged() {
        applyFilters()
    }

    func toggleAccessibleOnly() {
        accessibleOnly.toggle()
        applyFilters()
    }

    func resetFilters() {
        searchText = ""
        accessibleOnly = false
        applyFilters()
    }

    func selectToilet(_ toilet: Toilet) {
        selectedToilet = toilet
        withAnimation(.easeInOut(duration: 0.35)) {
            cameraPosition = .region(
                MKCoordinateRegion(
                    center: toilet.coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)
                )
            )
        }
    }

    func clearSelection() {
        selectedToilet = nil
    }

    func zoomIn() {
        adjustZoom(by: 0.65)
    }

    func zoomOut() {
        adjustZoom(by: 1.5)
    }

    func distanceText(from userLocation: CLLocationCoordinate2D?) -> String {
        guard let selected = selectedToilet else {
            return "Select a marker to see details."
        }

        guard let userLocation else {
            return "Enable location to see distance."
        }

        let distance = CLLocation(latitude: userLocation.latitude, longitude: userLocation.longitude)
            .distance(from: CLLocation(latitude: selected.latitude, longitude: selected.longitude))

        if distance < 1000 {
            return "\(Int(distance.rounded())) m away"
        }

        return String(format: "%.1f km away", distance / 1000)
    }

    func openDirections(from userLocation: CLLocationCoordinate2D?) {
        guard let selected = selectedToilet else { return }

        let destination = MKMapItem(placemark: MKPlacemark(coordinate: selected.coordinate))
        destination.name = selected.name

        var options: [String: Any] = [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking
        ]

        if let userLocation {
            let source = MKMapItem(placemark: MKPlacemark(coordinate: userLocation))
            source.name = "Current Location"
            MKMapItem.openMaps(with: [source, destination], launchOptions: options)
            return
        }

        options[MKLaunchOptionsMapCenterKey] = NSValue(mkCoordinate: selected.coordinate)
        destination.openInMaps(launchOptions: options)
    }

    private func applyFilters() {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        filteredToilets = allToilets.filter { toilet in
            let accessibleMatch = !accessibleOnly || toilet.features.accessible == "Y"
            guard accessibleMatch else { return false }

            guard !query.isEmpty else { return true }
            return toilet.name.lowercased().contains(query) || toilet.area.lowercased().contains(query)
        }

        if let selectedToilet, !filteredToilets.contains(where: { $0.id == selectedToilet.id }) {
            self.selectedToilet = nil
        }

        refreshVisibleToilets()
        updateStatusText()
    }

    private func refreshVisibleToilets() {
        let inView: [Toilet]
        if let currentRegion {
            inView = filteredToilets.filter { toilet in
                currentRegion.contains(latitude: toilet.latitude, longitude: toilet.longitude)
            }
        } else {
            inView = filteredToilets
        }

        hiddenByLimit = max(0, inView.count - markerLimit)
        visibleToilets = Array(inView.prefix(markerLimit))
    }

    private func updateStatusText() {
        guard !filteredToilets.isEmpty else {
            statusText = "No matching toilets. Try removing some filters."
            return
        }

        if visibleToilets.isEmpty {
            statusText = "No toilets in this map area. Move or zoom the map to explore other areas."
            return
        }

        let limitHint = hiddenByLimit > 0 ? " Zoom in to load \(hiddenByLimit) more." : ""

        if accessibleOnly && !searchText.isEmpty {
            statusText = "Found \(filteredToilets.count) accessible matches. \(visibleToilets.count) visible on map.\(limitHint)"
            return
        }

        if accessibleOnly {
            statusText = "Showing \(filteredToilets.count) accessible toilets. \(visibleToilets.count) visible on map.\(limitHint)"
            return
        }

        if !searchText.isEmpty {
            statusText = "Found \(filteredToilets.count) matches. \(visibleToilets.count) visible on map.\(limitHint)"
            return
        }

        statusText = "Showing \(filteredToilets.count) toilets. \(visibleToilets.count) visible on map.\(limitHint)"
    }

    private func adjustZoom(by factor: Double) {
        let baseRegion = currentRegion ?? Self.initialRegion
        let minDelta = 0.0007
        let maxDelta = 120.0

        let nextRegion = MKCoordinateRegion(
            center: baseRegion.center,
            span: MKCoordinateSpan(
                latitudeDelta: min(max(baseRegion.span.latitudeDelta * factor, minDelta), maxDelta),
                longitudeDelta: min(max(baseRegion.span.longitudeDelta * factor, minDelta), maxDelta)
            )
        )

        currentRegion = nextRegion
        withAnimation(.easeInOut(duration: 0.2)) {
            cameraPosition = .region(nextRegion)
        }

        refreshVisibleToilets()
        updateStatusText()
    }

    private func loadToiletsFromBundle() -> [Toilet]? {
        guard let url = Bundle.main.url(forResource: "toilets", withExtension: "csv") else {
            return nil
        }

        guard let content = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }

        let rows = parseCSVRows(content)
        guard rows.count > 1 else { return nil }

        let headers = rows[0]
        let headerIndex = Dictionary(uniqueKeysWithValues: headers.enumerated().map { ($1, $0) })

        return rows.dropFirst().compactMap { row in
            guard !row.isEmpty else { return nil }

            func value(_ key: String) -> String {
                guard let index = headerIndex[key], index < row.count else { return "" }
                return row[index]
            }

            guard value("active") == "true" else { return nil }
            guard let latitude = Double(value("latitude")), let longitude = Double(value("longitude")) else {
                return nil
            }

            let name = normalized(value("name")).isEmpty ? "Unnamed toilet" : normalized(value("name"))
            let area = parseAreaName(from: value("areas"))
            let note = normalized(value("notes"))
            let paymentDetails = normalized(value("payment_details"))
            let commentBody = note.isEmpty ? (paymentDetails.isEmpty ? "No notes yet." : paymentDetails) : note
            let noPayment = normalized(value("no_payment")).lowercased()
            let paid = noPayment == "false" || !paymentDetails.isEmpty
            let openingTimes = parseOpeningTimes(from: value("opening_times"))

            return Toilet(
                id: value("id").isEmpty ? UUID().uuidString : value("id"),
                name: name,
                area: area,
                latitude: latitude,
                longitude: longitude,
                paid: paid,
                comment: "Comment: \(commentBody)",
                features: ToiletFeatures(
                    women: featureFlag(from: value("women")),
                    men: featureFlag(from: value("men")),
                    accessible: featureFlag(from: value("accessible")),
                    neutral: featureFlag(from: value("all_gender"))
                ),
                hours: ToiletHours(
                    today: formatDayHours(openingTimes: openingTimes, dayIndex: todayDayIndex),
                    sat: formatDayHours(openingTimes: openingTimes, dayIndex: 5),
                    sun: formatDayHours(openingTimes: openingTimes, dayIndex: 6)
                )
            )
        }
    }

    private func parseCSVRows(_ content: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false

        var index = content.startIndex
        while index < content.endIndex {
            let character = content[index]

            if inQuotes {
                if character == "\"" {
                    let next = content.index(after: index)
                    if next < content.endIndex, content[next] == "\"" {
                        field.append("\"")
                        index = next
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(character)
                }
                index = content.index(after: index)
                continue
            }

            if character == "\"" {
                inQuotes = true
                index = content.index(after: index)
                continue
            }

            if character == "," {
                row.append(field)
                field = ""
                index = content.index(after: index)
                continue
            }

            if character == "\n" {
                row.append(field)
                rows.append(row)
                row = []
                field = ""
                index = content.index(after: index)
                continue
            }

            if character != "\r" {
                field.append(character)
            }

            index = content.index(after: index)
        }

        if !field.isEmpty || !row.isEmpty {
            row.append(field)
            rows.append(row)
        }

        return rows
    }

    private func normalized(_ value: String) -> String {
        value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func featureFlag(from value: String) -> String {
        let normalizedValue = normalized(value).lowercased()
        if normalizedValue == "true" { return "Y" }
        if normalizedValue == "false" { return "N" }
        return "?"
    }

    private func parseAreaName(from value: String) -> String {
        guard let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let name = object["name"] as? String,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "Unknown area"
        }

        return name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func parseOpeningTimes(from value: String) -> [[String]] {
        guard let data = value.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [[Any]] else {
            return []
        }

        return raw.map { day in
            day.compactMap { $0 as? String }
        }
    }

    private func formatDayHours(openingTimes: [[String]], dayIndex: Int) -> String {
        let label = dayLabels.indices.contains(dayIndex) ? dayLabels[dayIndex] : "Day"
        guard openingTimes.indices.contains(dayIndex) else {
            return "\(label) Closed"
        }

        let slots = openingTimes[dayIndex]
        guard slots.count >= 2 else {
            return "\(label) Closed"
        }

        let open = normalized(slots[0])
        let close = normalized(slots[1])

        guard !open.isEmpty, !close.isEmpty else {
            return "\(label) Closed"
        }

        return "\(label) \(open) - \(close)"
    }

    private var fallbackToilets: [Toilet] {
        [
            Toilet(
                id: "city",
                name: "City and Guilds building",
                area: "Imperial College London",
                latitude: 51.49876,
                longitude: -0.17687,
                paid: false,
                comment: "Comment: clean today, short queue.",
                features: ToiletFeatures(women: "Y", men: "Y", accessible: "N", neutral: "?"),
                hours: ToiletHours(today: "Tue 09:00 - 17:00", sat: "Sat Closed", sun: "Sun Closed")
            ),
            Toilet(
                id: "station",
                name: "South Kensington Station",
                area: "Partner paid toilet",
                latitude: 51.49412,
                longitude: -0.17392,
                paid: true,
                comment: "Comment: QR gate required, usually busy after lectures.",
                features: ToiletFeatures(women: "Y", men: "Y", accessible: "Y", neutral: "N"),
                hours: ToiletHours(today: "Tue 06:00 - 23:30", sat: "Sat 07:00 - 23:30", sun: "Sun 08:00 - 22:30")
            ),
            Toilet(
                id: "library",
                name: "Imperial Library",
                area: "Campus access",
                latitude: 51.49818,
                longitude: -0.17821,
                paid: false,
                comment: "Comment: open late with accessible facilities nearby.",
                features: ToiletFeatures(women: "Y", men: "Y", accessible: "Y", neutral: "Y"),
                hours: ToiletHours(today: "Tue 08:30 - 23:00", sat: "Sat 10:00 - 20:00", sun: "Sun 10:00 - 20:00")
            ),
            Toilet(
                id: "museum",
                name: "Museum Quarter",
                area: "Public toilet",
                latitude: 51.49661,
                longitude: -0.17222,
                paid: false,
                comment: "Comment: free access, closes early on Sundays.",
                features: ToiletFeatures(women: "Y", men: "Y", accessible: "Y", neutral: "N"),
                hours: ToiletHours(today: "Tue 10:00 - 18:00", sat: "Sat 10:00 - 18:00", sun: "Sun 10:00 - 17:00")
            )
        ]
    }
}

private final class UserLocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: CLLocationCoordinate2D?
    @Published var status: CLAuthorizationStatus = .notDetermined

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    func requestCurrentLocation() {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            break
        case .notDetermined:
            requestPermission()
        @unknown default:
            break
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        status = manager.authorizationStatus
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        coordinate = locations.last?.coordinate
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("Location update failed: \(error.localizedDescription)")
    }
}

private extension MKCoordinateRegion {
    func contains(latitude: Double, longitude: Double) -> Bool {
        let halfLatitude = span.latitudeDelta / 2
        let halfLongitude = span.longitudeDelta / 2

        let latMin = center.latitude - halfLatitude
        let latMax = center.latitude + halfLatitude
        let lonMin = center.longitude - halfLongitude
        let lonMax = center.longitude + halfLongitude

        return latitude >= latMin && latitude <= latMax && longitude >= lonMin && longitude <= lonMax
    }
}

private struct ToiletMarkerView: View {
    let paid: Bool
    let selected: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9)
                .fill(paid ? Color.yellow : Color.pink)
                .frame(width: 24, height: 24)
                .rotationEffect(.degrees(45))
                .overlay(
                    Circle()
                        .fill(.white)
                        .frame(width: 8, height: 8)
                )
                .shadow(color: .black.opacity(0.22), radius: 6, y: 4)

            if selected {
                Circle()
                    .stroke(Color.pink.opacity(0.35), lineWidth: 5)
                    .frame(width: 34, height: 34)
            }
        }
    }
}

private struct UserDotView: View {
    var body: some View {
        Circle()
            .fill(Color.blue)
            .frame(width: 16, height: 16)
            .overlay(Circle().stroke(Color.white, lineWidth: 3))
            .overlay(Circle().stroke(Color.blue.opacity(0.2), lineWidth: 8).scaleEffect(1.15))
    }
}

struct ContentView: View {
    @StateObject private var viewModel = ToiletsViewModel()
    @StateObject private var locationManager = UserLocationManager()
    @State private var selectedTab: AppTab = .map
    @State private var shouldCenterOnNextLocation = false

    var body: some View {
        TabView(selection: $selectedTab) {
            mapTab
                .tabItem {
                    Label("Map", systemImage: "map")
                }
                .tag(AppTab.map)

            qrTab
                .tabItem {
                    Label("Access QR", systemImage: "qrcode")
                }
                .tag(AppTab.qr)

            accountTab
                .tabItem {
                    Label("Account", systemImage: "person.crop.circle")
                }
                .tag(AppTab.account)
        }
        .task {
            viewModel.loadDataIfNeeded()
        }
        .onReceive(locationManager.$coordinate.compactMap { $0 }) { newValue in
            if viewModel.selectedToilet != nil {
                viewModel.statusText = "Location found. Distances are now updated."
            }
            if shouldCenterOnNextLocation, selectedTab == .map {
                shouldCenterOnNextLocation = false
                withAnimation(.easeInOut(duration: 0.35)) {
                    viewModel.cameraPosition = .region(
                        MKCoordinateRegion(
                            center: newValue,
                            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                        )
                    )
                }
            }
        }
    }

    private var mapTab: some View {
        ZStack(alignment: .top) {
            Map(position: $viewModel.cameraPosition, interactionModes: .all) {
                ForEach(viewModel.visibleToilets) { toilet in
                    Annotation(toilet.name, coordinate: toilet.coordinate, anchor: .bottom) {
                        Button {
                            viewModel.selectToilet(toilet)
                        } label: {
                            ToiletMarkerView(paid: toilet.paid, selected: viewModel.selectedToilet?.id == toilet.id)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if let coordinate = locationManager.coordinate {
                    Annotation("Current location", coordinate: coordinate) {
                        UserDotView()
                    }
                }
            }
            .mapStyle(.standard(elevation: .realistic))
            .mapControls {
                MapCompass()
                MapScaleView()
            }
            .ignoresSafeArea(edges: .top)
            .onMapCameraChange(frequency: .onEnd) { context in
                viewModel.onMapRegionChanged(context.region)
            }

            VStack(spacing: 12) {
                statusBadge
                searchCard
                HStack {
                    Spacer()
                    zoomControl
                }
                Spacer()
                if let toilet = viewModel.selectedToilet {
                    detailsCard(toilet: toilet)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)
        }
    }

    private var statusBadge: some View {
        Text(viewModel.statusText)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private var searchCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Search")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.blue)

            TextField("Search toilet or area...", text: $viewModel.searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(.background, in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(Color.blue.opacity(0.4), lineWidth: 1)
                )
                .onChange(of: viewModel.searchText) { _, _ in
                    viewModel.onSearchTextChanged()
                }

            Button(viewModel.isAccessibleOnly ? "Accessible only: ON" : "Accessible only") {
                viewModel.toggleAccessibleOnly()
            }

            Button("Show all toilets") {
                viewModel.resetFilters()
            }

            Button("Find near me") {
                shouldCenterOnNextLocation = true
                locationManager.requestCurrentLocation()
            }
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var zoomControl: some View {
        VStack(spacing: 6) {
            Button {
                viewModel.zoomIn()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)

            Divider()
                .frame(width: 24)

            Button {
                viewModel.zoomOut()
            } label: {
                Image(systemName: "minus")
                    .font(.system(size: 16, weight: .bold))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 6)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func detailsCard(toilet: Toilet) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(toilet.name)
                        .font(.headline)
                    Text(toilet.area)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    viewModel.clearSelection()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .padding(8)
                        .background(.thinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 10) {
                Button("Directions") {
                    viewModel.openDirections(from: locationManager.coordinate)
                }
                .buttonStyle(.borderedProminent)

                Text(viewModel.distanceText(from: locationManager.coordinate))
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Spacer()
            }

            featureGrid(toilet: toilet)

            Text(toilet.comment)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func featureGrid(toilet: Toilet) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Features")
                    .font(.caption)
                    .fontWeight(.semibold)
                featureRow("Women", toilet.features.women)
                featureRow("Men", toilet.features.men)
                featureRow("Accessible", toilet.features.accessible)
                featureRow("Gender Neutral", toilet.features.neutral)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 5) {
                Text("Opening Hours")
                    .font(.caption)
                    .fontWeight(.semibold)
                Text(toilet.hours.today)
                Text(toilet.hours.sat)
                Text(toilet.hours.sun)
            }
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(Color.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func featureRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .fontWeight(.semibold)
        }
        .font(.footnote)
    }

    private var qrTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Access QR")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.blue)

                Text("Use at partner paid toilets")
                    .font(.title3)
                    .fontWeight(.semibold)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Toilet Access Pass")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("South Kensington Station Toilet")
                        .font(.headline)
                        .foregroundStyle(.secondary)

                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.white)
                        .frame(height: 220)
                        .overlay {
                            Image(systemName: "qrcode")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 160, height: 160)
                                .foregroundStyle(.black)
                        }

                    Text("Valid for gate entry")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Expires in 14:59 after activation")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(18)
                .background(Color.yellow.opacity(0.2), in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                HStack(spacing: 12) {
                    Button("Activate") {}
                        .buttonStyle(.borderedProminent)
                        .tint(.teal)
                    Button("Details") {}
                        .buttonStyle(.bordered)
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
    }

    private var accountTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Account")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.blue)

                Text("Wallet, history and subscription")
                    .font(.title3)
                    .fontWeight(.semibold)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Wallet balance")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.9))
                    Text("GBP 8.40")
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)

                    Button("Top up") {}
                        .buttonStyle(.bordered)
                        .tint(.white)
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.teal, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                cardView(title: "Subscription") {
                    Text("Campus Plus - renews 26 Jun")
                        .foregroundStyle(.secondary)
                    Text("Monthly free toilet access tickets: 3 left")
                        .foregroundStyle(.secondary)
                }

                cardView(title: "Toilet access history") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("South Kensington Station")
                            .fontWeight(.semibold)
                        Text("Today 14:22 - QR access - GBP 0.50")
                            .foregroundStyle(.secondary)

                        Divider()

                        Text("Imperial Library")
                            .fontWeight(.semibold)
                        Text("Yesterday 18:05 - free access")
                            .foregroundStyle(.secondary)
                    }
                }

                cardView(title: "Privacy note", background: Color.teal.opacity(0.15)) {
                    Text("Let users hide or delete sensitive visit history.")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func cardView<Content: View>(title: String, background: Color = .white, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            content()
                .font(.subheadline)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

#if DEBUG
struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
#endif
