import Foundation
import SwiftSyntax
import SwiftParser

// Navigation evidence is collected independently of preview construction.
// This visitor reads syntax; it never evaluates closures, initializers or macros.
final class References: SyntaxVisitor {
  var calls: [String] = []
  override func visit(_ node: DeclReferenceExprSyntax) -> SyntaxVisitorContinueKind {
    calls.append(node.baseName.text); return .visitChildren
  }
  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    if let name = callName(node) { calls.append(name) }
    return .visitChildren
  }
}
func callName(_ node: FunctionCallExprSyntax) -> String? {
  if let ref = node.calledExpression.as(DeclReferenceExprSyntax.self) { return ref.baseName.text }
  return node.calledExpression.as(MemberAccessExprSyntax.self)?.declName.baseName.text
}
func references(_ node: some SyntaxProtocol) -> [String] {
  let visitor = References(viewMode: .sourceAccurate); visitor.walk(node); return Array(Set(visitor.calls)).sorted()
}

// A destination's decorators and constructor arguments are not separate routes.
final class DestinationReferences: SyntaxVisitor {
  var names = Set<String>()
  override func visit(_ node: DeclReferenceExprSyntax) -> SyntaxVisitorContinueKind {
    names.insert(node.baseName.text); return .skipChildren
  }
  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    if let member = node.calledExpression.as(MemberAccessExprSyntax.self), let base = member.base {
      walk(base); return .skipChildren
    }
    if let name = callName(node) {
      names.insert(name)
      if ["NavigationStack", "NavigationView", "Group", "ZStack", "VStack", "HStack"].contains(name), let content = node.trailingClosure { walk(content) }
    }
    return .skipChildren
  }
}
func destinationReferences(_ node: some SyntaxProtocol) -> [String] {
  let visitor = DestinationReferences(viewMode: .sourceAccurate); visitor.walk(node); return visitor.names.sorted()
}
final class Identifiers: SyntaxVisitor {
  var names = Set<String>()
  override func visit(_ node: DeclReferenceExprSyntax) -> SyntaxVisitorContinueKind {
    if let member = node.parent?.as(MemberAccessExprSyntax.self), member.declName == node { return .skipChildren }
    names.insert(node.baseName.text); return .visitChildren
  }
}
func identifiers(_ node: some SyntaxProtocol) -> [String] {
  let visitor = Identifiers(viewMode: .sourceAccurate); visitor.walk(node); return visitor.names.sorted()
}

final class FlowScan: SyntaxVisitor {
  var declarations: [[String: Any]] = []
  var calls: [[String: Any]] = []
  var boundaries: [[String: Any]] = []
  var properties: [[String: Any]] = []
  var bodies: [String: (Int, Int, String, Int)] = [:]
  var extensions: [[String: Any]] = []
  var lifecycle: [String: String] = [:]
  var scopes: [String] = []
  var functions: [String] = []
  let converter: SourceLocationConverter
  init(tree: SourceFileSyntax, file: String) {
    converter = SourceLocationConverter(fileName: file, tree: tree)
    super.init(viewMode: .sourceAccurate)
  }
  func enter(_ name: String, node: some DeclSyntaxProtocol, inherited: InheritanceClauseSyntax?, members: MemberBlockSyntax, attributes: AttributeListSyntax) {
    let qualified = (scopes + [name]).joined(separator: ".")
    scopes.append(name)
    let types = inherited?.inheritedTypes.map { $0.type.trimmedDescription } ?? []
    let isView = types.contains { ["View", "SwiftUI.View", "UIViewRepresentable", "UIViewControllerRepresentable"].contains($0) }
    var requirements: [String] = []
    var bodyRoot = ""
    var memberNames: [String] = []
    var fields: [[String: Any]] = []
    var environment: [[String: String]] = []
    for member in members.members {
      if let variable = member.decl.as(VariableDeclSyntax.self) {
        if variable.modifiers.contains(where: { ["static", "class"].contains($0.name.text) }) { continue }
        memberNames += variable.bindings.map { $0.pattern.trimmedDescription }
        for binding in variable.bindings {
          for item in variable.attributes {
            guard let attribute = item.as(AttributeSyntax.self) else { continue }
            let name = attribute.attributeName.trimmedDescription
            if name == "Environment", let arguments = attribute.arguments?.as(LabeledExprListSyntax.self),
               let value = arguments.first?.expression.as(MemberAccessExprSyntax.self), value.declName.baseName.text == "self", let base = value.base {
              environment.append(["type": base.trimmedDescription, "kind": "typed"])
            }
            if name == "EnvironmentObject", let annotation = binding.typeAnnotation {
              environment.append(["type": annotation.type.trimmedDescription, "kind": "object"])
            }
          }
          var type = binding.typeAnnotation?.type.trimmedDescription ?? ""
          if type.isEmpty, let value = binding.initializer?.value {
            if let call = value.as(FunctionCallExprSyntax.self) { type = callName(call) ?? "" }
            if let member = value.as(MemberAccessExprSyntax.self) { type = member.base?.trimmedDescription ?? "" }
            if let array = value.as(ArrayExprSyntax.self), let call = array.elements.first?.expression.as(FunctionCallExprSyntax.self) { type = "[" + (callName(call) ?? "") + "]" }
          }
          let environmentKey = variable.attributes.compactMap { $0.as(AttributeSyntax.self) }.first(where: { $0.attributeName.trimmedDescription == "Environment" })?.arguments?.as(LabeledExprListSyntax.self)?.first?.expression.trimmedDescription ?? ""
          fields.append(["name": binding.pattern.trimmedDescription, "type": type, "environmentKey": environmentKey, "nonmutating": variable.attributes.contains { item in
            guard let attribute = item.as(AttributeSyntax.self) else { return false }
            return ["State", "Binding", "AppStorage", "SceneStorage", "FocusState"].contains(attribute.attributeName.trimmedDescription)
          }, "mutable": variable.bindingSpecifier.text == "var" && binding.accessorBlock == nil && !variable.modifiers.contains(where: { $0.detail?.trimmedDescription == "set" }), "accessible": !variable.modifiers.contains(where: { ["private", "fileprivate"].contains($0.name.text) && $0.detail == nil })])
        }
      }
      if let function = member.decl.as(FunctionDeclSyntax.self) { memberNames.append(function.name.text) }
    }
    for member in members.members {
      guard let variable = member.decl.as(VariableDeclSyntax.self) else { continue }
      for binding in variable.bindings where binding.pattern.trimmedDescription == "body" {
        if let statements = binding.accessorBlock?.accessors.as(CodeBlockItemListSyntax.self),
           !statements.contains(where: { $0.item.is(ReturnStmtSyntax.self) }), isView {
          // Preserve only outer lifecycle modifiers while projecting. Keeping the
          // original body hidden would mount unrelated UI and duplicate services.
          if statements.count == 1, var expression = statements.first?.item.as(ExprSyntax.self) {
            var modifiers: [String] = []
            while let call = expression.as(FunctionCallExprSyntax.self),
                  let member = call.calledExpression.as(MemberAccessExprSyntax.self), let base = member.base {
              if ["task", "onAppear", "onDisappear", "onChange"].contains(member.declName.baseName.text) {
                let bytes = Array(call.description.utf8)
                let offset = base.endPosition.utf8Offset - call.position.utf8Offset
                modifiers.insert(String(decoding: bytes[offset...], as: UTF8.self), at: 0)
              }
              expression = base
            }
            lifecycle[qualified] = modifiers.joined()
          }
          bodies[qualified] = (statements.position.utf8Offset, statements.endPosition.utf8Offset, statements.description, members.rightBrace.position.utf8Offset)
        }
        if let statements = binding.accessorBlock?.accessors.as(CodeBlockItemListSyntax.self), statements.count == 1,
           let call = statements.first?.item.as(FunctionCallExprSyntax.self),
           let root = call.calledExpression.as(DeclReferenceExprSyntax.self), call.trailingClosure == nil {
          bodyRoot = root.baseName.text
        }
      }
    }
    let initializers = members.members.compactMap { $0.decl.as(InitializerDeclSyntax.self) }
    if let initializer = initializers.first {
      requirements = initializer.signature.parameterClause.parameters.filter { $0.defaultValue == nil }.map { $0.firstName.text + ": " + $0.type.trimmedDescription }
    } else {
      for member in members.members {
        guard let variable = member.decl.as(VariableDeclSyntax.self) else { continue }
        if variable.modifiers.contains(where: { ["static", "class"].contains($0.name.text) }) { continue }
        let managed = ["State", "StateObject", "Environment", "EnvironmentObject", "FocusState", "Namespace", "AppStorage", "SceneStorage"]
        if variable.attributes.contains(where: { item in
          guard let attribute = item.as(AttributeSyntax.self) else { return false }
          return managed.contains(attribute.attributeName.trimmedDescription)
        }) { continue }
        for binding in variable.bindings where binding.initializer == nil && binding.accessorBlock == nil {
          let isBinding = variable.attributes.contains { $0.as(AttributeSyntax.self)?.attributeName.trimmedDescription == "Binding" }
          requirements.append(binding.pattern.trimmedDescription + (binding.typeAnnotation.map { ": " + (isBinding ? "Binding<" + $0.type.trimmedDescription + ">" : $0.type.trimmedDescription) } ?? ""))
        }
      }
    }
    declarations.append(["name": name, "symbol": qualified, "isView": isView, "referenceType": node.is(ClassDeclSyntax.self),
      "main": attributes.contains { $0.trimmedDescription == "@main" },
      "line": converter.location(for: node.positionAfterSkippingLeadingTrivia).line,
      "offset": node.positionAfterSkippingLeadingTrivia.utf8Offset,
      "nativeViewType": members.members.compactMap { $0.decl.as(FunctionDeclSyntax.self) }.first(where: { $0.name.text == "makeUIView" })?.signature.returnClause?.type.trimmedDescription ?? "",
      "parameters": initializers.first?.signature.parameterClause.parameters.map { ["name": $0.firstName.text, "type": $0.type.trimmedDescription, "hasDefault": $0.defaultValue != nil] as [String: Any] } ?? [],
      "references": references(node), "requirements": requirements, "bodyRoot": bodyRoot, "members": memberNames, "environment": environment, "fields": fields, "inherits": types, "accessible": !((node.as(StructDeclSyntax.self)?.modifiers ?? node.as(ClassDeclSyntax.self)?.modifiers)?.contains(where: { ["private", "fileprivate"].contains($0.name.text) && $0.detail == nil }) ?? false), "projectable": bodies[qualified] != nil, "generic": node.as(StructDeclSyntax.self)?.genericParameterClause != nil])
  }
  override func visit(_ node: ExtensionDeclSyntax) -> SyntaxVisitorContinueKind {
    var fields: [[String: Any]] = []
    for member in node.memberBlock.members {
      guard let variable = member.decl.as(VariableDeclSyntax.self) else { continue }
      for binding in variable.bindings {
        if let type = binding.typeAnnotation?.type.trimmedDescription {
          fields.append(["name": binding.pattern.trimmedDescription, "type": type, "accessible": !variable.modifiers.contains(where: { ["private", "fileprivate"].contains($0.name.text) && $0.detail == nil })])
        }
      }
    }
    extensions.append(["type": node.extendedType.trimmedDescription, "fields": fields])
    scopes.append(node.extendedType.trimmedDescription)
    return .visitChildren
  }
  override func visitPost(_ node: ExtensionDeclSyntax) { scopes.removeLast() }
  override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
    enter(node.name.text, node: node, inherited: node.inheritanceClause, members: node.memberBlock, attributes: node.attributes); return .visitChildren
  }
  override func visitPost(_ node: StructDeclSyntax) { scopes.removeLast() }
  override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind {
    enter(node.name.text, node: node, inherited: node.inheritanceClause, members: node.memberBlock, attributes: node.attributes); return .visitChildren
  }
  override func visitPost(_ node: ClassDeclSyntax) { scopes.removeLast() }
  override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
    for binding in node.bindings {
      if let accessor = binding.accessorBlock {
        properties.append(["owner": scopes.joined(separator: "."), "name": binding.pattern.trimmedDescription, "references": destinationReferences(accessor)])
      }
    }
    return .visitChildren
  }

  override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind { functions.append(node.name.text); return .visitChildren }
  override func visitPost(_ node: FunctionDeclSyntax) { functions.removeLast() }
  override func visit(_ node: MacroExpansionDeclSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
  override func visit(_ node: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind { .skipChildren }
  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    guard !scopes.isEmpty, let name = callName(node) else { return .visitChildren }
    let owner = scopes.joined(separator: ".")
    var cursor = node.parent
    var stateBranch = false
    var stateSelector = ""
    var stateCase = ""
    var inDestination = false
    var localNames = Set<String>()
    var scopeBindings: [[String: Any]] = []
    while let parent = cursor {
      if parent.is(StructDeclSyntax.self) || parent.is(ClassDeclSyntax.self) { break }
      if let branch = parent.as(SwitchCaseSyntax.self) {
        stateBranch = true
        if stateCase.isEmpty, let label = branch.label.as(SwitchCaseLabelSyntax.self), label.caseItems.count == 1, label.caseItems.first!.whereClause == nil {
          stateCase = label.caseItems.first!.pattern.trimmedDescription
        }
      }
      if let branch = parent.as(SwitchExprSyntax.self), stateSelector.isEmpty { stateSelector = branch.subject.trimmedDescription }
      if let function = parent.as(FunctionDeclSyntax.self) {
        for parameter in function.signature.parameterClause.parameters { localNames.insert(parameter.secondName?.text ?? parameter.firstName.text) }
      }
      if let closure = parent.as(ClosureExprSyntax.self) {
        if let parameters = closure.signature?.parameterClause?.as(ClosureShorthandParameterListSyntax.self) {
          parameters.forEach { localNames.insert($0.name.text) }
          if parameters.count == 1, let parameter = parameters.first,
             let call = closure.parent?.as(FunctionCallExprSyntax.self), callName(call) == "ForEach",
             call.trailingClosure == closure, let collection = call.arguments.first?.expression,
             !collection.trimmedDescription.hasPrefix("$") {
            scopeBindings.append(["name": parameter.name.text, "expression": "(" + collection.trimmedDescription + ").first", "identifiers": identifiers(collection), "offset": call.position.utf8Offset, "kind": "collection"])
          }
        }
        if let parameters = closure.signature?.parameterClause?.as(ClosureParameterClauseSyntax.self) {
          parameters.parameters.forEach { localNames.insert($0.secondName?.text ?? $0.firstName.text) }
        }
      }
      if let items = parent.as(CodeBlockItemListSyntax.self) {
        for item in items where item.position < node.position {
          if let variable = item.item.as(VariableDeclSyntax.self) { variable.bindings.forEach { localNames.insert($0.pattern.trimmedDescription) } }
        }
      }
      if let branch = parent.as(IfExprSyntax.self) {
        for condition in branch.conditions {
          if let binding = condition.condition.as(OptionalBindingConditionSyntax.self) {
            localNames.insert(binding.pattern.trimmedDescription)
            if let name = binding.pattern.as(IdentifierPatternSyntax.self)?.identifier.text,
               node.position >= branch.body.position, node.position < branch.body.endPosition {
              let expression = binding.initializer?.value.trimmedDescription ?? name
              scopeBindings.append(["name": name, "expression": expression, "identifiers": binding.initializer.map { identifiers($0.value) } ?? [name], "offset": binding.position.utf8Offset, "kind": "optional"])
            }
          }
        }
      }
      if let call = parent.as(FunctionCallExprSyntax.self), let kind = callName(call),
         ["NavigationLink", "navigationDestination", "sheet", "fullScreenCover"].contains(kind) {
        let position = node.positionAfterSkippingLeadingTrivia.utf8Offset
        let closures = ([call.trailingClosure].compactMap { $0 } + call.additionalTrailingClosures.map { $0.closure })
        if closures.contains(where: { position >= $0.position.utf8Offset && position < $0.endPosition.utf8Offset }) { inDestination = true }
        if let destination = call.arguments.first(where: { ["destination", "content"].contains($0.label?.text ?? "") }), position >= destination.position.utf8Offset && position < destination.endPosition.utf8Offset { inDestination = true }
      }
      cursor = parent.parent
    }
    var callbacks = node.arguments.flatMap { argument -> [String] in
      guard let closure = argument.expression.as(ClosureExprSyntax.self) else { return [] }
      return references(closure)
    }
    if let closure = node.trailingClosure { callbacks += references(closure) }
    let callPosition = node.calledExpression.as(MemberAccessExprSyntax.self)?.declName.positionAfterSkippingLeadingTrivia ?? node.calledExpression.positionAfterSkippingLeadingTrivia
    calls.append(["owner": owner, "name": name, "function": functions.last ?? "", "stateBranch": stateBranch, "stateSelector": stateSelector, "stateCase": stateCase,
      "callbacks": callbacks, "inDestination": inDestination, "line": converter.location(for: callPosition).line,
      "scopeBindings": scopeBindings.sorted { ($0["offset"] as! Int) < ($1["offset"] as! Int) },
      "expression": node.trimmedDescription, "locals": localNames.sorted(), "identifiers": identifiers(node), "constructor": node.calledExpression.is(DeclReferenceExprSyntax.self),
      "projection": owner + ":" + String(callPosition.utf8Offset)])
    guard ["NavigationLink", "navigationDestination", "sheet", "fullScreenCover", "WindowGroup"].contains(name) else { return .visitChildren }
    var destinations: [String] = []
    if let destination = node.arguments.first(where: { ["destination", "content"].contains($0.label?.text ?? "") }) { destinations += destinationReferences(destination.expression) }
    if !node.arguments.contains(where: { $0.label?.text == "destination" }), let closure = node.trailingClosure { destinations += destinationReferences(closure) }
    for closure in node.additionalTrailingClosures where ["destination", "content"].contains(closure.label.text) { destinations += destinationReferences(closure.closure) }
    let route = node.arguments.first(where: { $0.label?.text == "for" })?.expression.trimmedDescription.replacingOccurrences(of: ".self", with: "")
    let value = node.arguments.first(where: { $0.label?.text == "value" }).flatMap { $0.expression.as(FunctionCallExprSyntax.self) }.flatMap(callName)
    let binding = node.arguments.first(where: { ["isPresented", "item"].contains($0.label?.text ?? "") })?.expression.trimmedDescription ?? ""
    boundaries.append(["owner": owner, "kind": name, "destinations": value == nil ? Array(Set(destinations)).sorted() : [],
      "route": route ?? "", "value": value ?? "", "binding": binding,
      "line": converter.location(for: callPosition).line,
      "offset": callPosition.utf8Offset])
    return .visitChildren
  }
}

// Source-only analysis. Never expands macros or evaluates the app.
final class PreviewProviders: SyntaxVisitor {
  var values: [[String: Any]] = []
  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    guard let name = callName(node), ["environment", "environmentObject"].contains(name), node.arguments.count == 1,
          let expression = node.arguments.first?.expression, let constructor = expression.as(FunctionCallExprSyntax.self),
          let type = constructor.calledExpression.as(DeclReferenceExprSyntax.self)?.baseName.text else { return .visitChildren }
    values.append(["type": type, "kind": name == "environmentObject" ? "object" : "typed", "expression": expression.trimmedDescription, "identifiers": identifiers(expression)])
    return .visitChildren
  }
}
final class PreviewSurfaceScan: SyntaxVisitor {
  var replacements: [(Int, Int, String)] = []
  var owners: [Int?] = []
  var fields = Set<Int>()
  var imageCalls = 0
  var boundsCalls = 0
  let imagesEnabled: Bool
  init(imagesEnabled: Bool) { self.imagesEnabled = imagesEnabled; super.init(viewMode: .sourceAccurate) }
  override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
    let types = ["View", "SwiftUI.View", "UIViewRepresentable", "UIViewControllerRepresentable", "SwiftUI.UIViewRepresentable", "SwiftUI.UIViewControllerRepresentable"]
    let isView = node.inheritanceClause?.inheritedTypes.contains { types.contains($0.type.trimmedDescription) } == true
    owners.append(isView ? node.memberBlock.rightBrace.position.utf8Offset : nil)
    return .visitChildren
  }
  override func visitPost(_ node: StructDeclSyntax) { owners.removeLast() }
  private func owner(_ node: Syntax, allowBridge: Bool = false) -> Int? {
    var cursor = node.parent
    while let parent = cursor {
      if let variable = parent.as(VariableDeclSyntax.self), variable.bindings.contains(where: { $0.pattern.trimmedDescription == "body" }) { return owners.last ?? nil }
      if let function = parent.as(FunctionDeclSyntax.self) {
        return allowBridge && ["makeUIView", "updateUIView", "makeUIViewController", "updateUIViewController"].contains(function.name.text) ? owners.last ?? nil : nil
      }
      if parent.is(InitializerDeclSyntax.self) || parent.is(ClassDeclSyntax.self) || parent.is(StructDeclSyntax.self) { break }
      cursor = parent.parent
    }
    return nil
  }
  private func inject(_ owner: Int) {
    if fields.insert(owner).inserted { replacements.append((owner, owner, "\n@Environment(\\.canvasPreview) private var _canvasPreviewContext\n")) }
  }
  override func visit(_ node: MemberAccessExprSyntax) -> SyntaxVisitorContinueKind {
    guard ["UIScreen.main.bounds", "UIKit.UIScreen.main.bounds"].contains(node.trimmedDescription), let owner = owner(Syntax(node), allowBridge: true) else { return .visitChildren }
    replacements.append((node.positionAfterSkippingLeadingTrivia.utf8Offset, node.endPositionBeforeTrailingTrivia.utf8Offset, "(_canvasPreviewContext?.bounds ?? UIScreen.main.bounds)"))
    boundsCalls += 1; inject(owner)
    return .skipChildren
  }
  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    guard imagesEnabled, let owner = owner(Syntax(node)),
          ["KFImage.url", "KFImage"].contains(node.calledExpression.trimmedDescription),
          node.arguments.count == 1, let argument = node.arguments.first,
          argument.label == nil, node.trailingClosure == nil else { return .visitChildren }
    let replacement = "CanvasPreviewImages.kingfisher(" + argument.expression.trimmedDescription + ", context: _canvasPreviewContext)"
    replacements.append((node.positionAfterSkippingLeadingTrivia.utf8Offset, node.endPositionBeforeTrailingTrivia.utf8Offset, replacement))
    imageCalls += 1; inject(owner)
    return .skipChildren
  }
}

final class MotionScan: SyntaxVisitor {
  var replacements: [(Int, Int, String)] = []
  override func visit(_ node: FunctionCallExprSyntax) -> SyntaxVisitorContinueKind {
    if node.arguments.isEmpty, node.trailingClosure == nil,
       ["CMMotionManager", "CoreMotion.CMMotionManager"].contains(node.calledExpression.trimmedDescription) {
      replacements.append((node.positionAfterSkippingLeadingTrivia.utf8Offset, node.endPositionBeforeTrailingTrivia.utf8Offset, "CanvasPreviewDeviceMotion.makeManager()"))
      return .skipChildren
    }
    return .visitChildren
  }

}

final class Scan: SyntaxVisitor {
  var previews: [[String: Any]] = []
  var views: [[String: Any]] = []
  var replacements: [(Int, Int, String)] = []
  var hasMain = false
  let file: String
  let previewModifiers: [String: String]
  init(file: String, previewModifiers: [String: String]) { self.file = file; self.previewModifiers = previewModifiers; super.init(viewMode: .sourceAccurate) }

  override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
    if let entry = node.attributes.first(where: { $0.trimmedDescription == "@main" }) {
      hasMain = true
      replacements.append((entry.positionAfterSkippingLeadingTrivia.utf8Offset, entry.endPositionBeforeTrailingTrivia.utf8Offset, ""))
      return .visitChildren
    }
    if node.inheritanceClause?.inheritedTypes.contains(where: { $0.type.trimmedDescription == "View" }) == true {
      views.append(["name": node.name.text, "offset": node.positionAfterSkippingLeadingTrivia.utf8Offset])
    }
    return .visitChildren
  }

  override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind {
    if let entry = node.attributes.first(where: { $0.trimmedDescription == "@main" }) {
      hasMain = true
      replacements.append((entry.positionAfterSkippingLeadingTrivia.utf8Offset, entry.endPositionBeforeTrailingTrivia.utf8Offset, ""))
      return .visitChildren
    }
    return .visitChildren
  }

  override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
    guard let adapter = node.attributes.compactMap({ $0.as(AttributeSyntax.self) }).first(where: {
      ["UIApplicationDelegateAdaptor", "NSApplicationDelegateAdaptor"].contains($0.attributeName.trimmedDescription)
    }), let arguments = adapter.arguments?.as(LabeledExprListSyntax.self),
      let member = arguments.first?.expression.as(MemberAccessExprSyntax.self), member.declName.baseName.text == "self", let type = member.base,
      node.bindings.count == 1, let binding = node.bindings.first, binding.initializer == nil else { return .visitChildren }
    var parent = node.parent
    while let ancestor = parent {
      if let app = ancestor.as(StructDeclSyntax.self) {
        guard app.attributes.contains(where: { $0.trimmedDescription == "@main" }) else { return .visitChildren }
        // Retain the delegate value for initializer references without registering
        // the app's delegate with SwiftUI and replacing Canvas's window lifecycle.
        let replacement = node.modifiers.description + "var " + binding.pattern.trimmedDescription + " = " + type.trimmedDescription + "()"
        replacements.append((node.positionAfterSkippingLeadingTrivia.utf8Offset, node.endPositionBeforeTrailingTrivia.utf8Offset, replacement))
        break
      }
      parent = ancestor.parent
    }
    return .visitChildren
  }
  override func visit(_ node: MacroExpansionDeclSyntax) -> SyntaxVisitorContinueKind {
    guard node.macroName.text == "Preview" else { return .visitChildren }
    process(node.arguments, node.trailingClosure, node.positionAfterSkippingLeadingTrivia.utf8Offset, node.endPositionBeforeTrailingTrivia.utf8Offset, availability: node.attributes.compactMap { $0.as(AttributeSyntax.self) }.filter { $0.attributeName.trimmedDescription == "available" }.compactMap { $0.arguments?.description })
    return .skipChildren
  }

  override func visit(_ node: MacroExpansionExprSyntax) -> SyntaxVisitorContinueKind {
    guard node.macroName.text == "Preview" else { return .visitChildren }
    process(node.arguments, node.trailingClosure, node.positionAfterSkippingLeadingTrivia.utf8Offset, node.endPositionBeforeTrailingTrivia.utf8Offset)
    return .skipChildren
  }

  func process(_ arguments: LabeledExprListSyntax, _ closure: ClosureExprSyntax?, _ start: Int, _ end: Int, availability: [String] = []) {
    let index = previews.count
    let title = arguments.first?.expression.as(StringLiteralExprSyntax.self)?.segments.first?.as(StringSegmentSyntax.self)?.content.text
    let factory = "canvasPreview_" + file.utf8.map { String(format: "%02x", $0) }.joined() + "_\(index)"
    let supported = closure?.statements.count == 1 && closure?.statements.first?.item.as(ExprSyntax.self) != nil && arguments.count <= (title == nil ? 0 : 1)
    var item: [String: Any] = ["name": title ?? "Preview \(index + 1)", "titled": title != nil, "factory": factory, "index": index, "offset": start, "references": closure.map { references($0) } ?? []]
    let providers = PreviewProviders(viewMode: .sourceAccurate)
    if let closure { providers.walk(closure) }
    item["providers"] = providers.values
    let replacement: String
    if supported, let expression = closure?.statements.first?.item.as(ExprSyntax.self) {
      let guards = availability.map { "guard #available(" + $0 + ") else { return CanvasPreviewHost.unavailable(context: context, issue: \"This preview requires a newer OS.\") }\n" }.joined()
      let rendered = previewModifiers[factory].map { "(" + expression.trimmedDescription + ")" + $0 } ?? expression.trimmedDescription
      replacement = "\n@MainActor func \(factory)(_ context: CanvasPreviewContext) -> UIViewController {\n  \(guards)return CanvasPreviewHost.make(\(rendered), context: context)\n}\n"
    } else {
      item["issue"] = "This preview needs an explicit factory: only a single view/controller expression and optional literal title are supported."
      replacement = "\n"
    }
    previews.append(item)
    replacements.append((start, end, replacement))
  }
}

let files = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: String]]
var results: [[String: Any]] = []
for input in files {
  let code = input["code"]!
  let modifiers = input["previewModifiers"].flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: String] } ?? [:]
  let scan = Scan(file: input["path"]!, previewModifiers: modifiers)
  let tree = Parser.parse(source: code)
  let coreMotion = tree.statements.contains { $0.item.as(ImportDeclSyntax.self)?.path.trimmedDescription == "CoreMotion" }
  scan.walk(tree)
  let flow = FlowScan(tree: tree, file: input["path"]!)
  flow.walk(tree)
  let selected = (input["projections"].flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [[String: Any]] }) ?? []
  let scenes = (input["scenes"].flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [[String: Any]] }) ?? []
  for (owner, body) in flow.bodies {
    let projections = selected.filter { $0["owner"] as? String == owner }
    let ownedScenes = scenes.filter { $0["owner"] as? String == owner }
    if projections.isEmpty && ownedScenes.isEmpty { continue }
    let branches = projections.map { call in
      let id = String(data: try! JSONSerialization.data(withJSONObject: call["id"]!, options: [.fragmentsAllowed, .withoutEscapingSlashes]), encoding: .utf8)!
      return "if _canvasProjection.first == " + id + " { (" + (call["expression"] as! String) + ").environment(\\.canvasProjection, Array(_canvasProjection.dropFirst())) }"
    }.joined(separator: " else ")
    var providers: [String: [String: String]] = [:]
    for projection in projections {
      for provider in projection["environment"] as? [[String: String]] ?? [] { providers[provider["type"]!] = provider }
    }
    // The normal branch retains its original modifiers. Only the projected
    // branch receives copied lifecycle work, so each callback runs once.
    var replacement = "Group { if !_canvasProjection.isEmpty { Group { " + branches + " }" + (flow.lifecycle[owner] ?? "") + " } else { _canvasOriginalBody } }"
    var declarations = ""
    for provider in providers.values.sorted(by: { $0["type"]! < $1["type"]! }) {
      let type = provider["type"]!, variable = provider["variable"]!, object = provider["kind"] == "object"
      declarations += "\n@" + (object ? "StateObject" : "State") + " private var " + variable + " = " + type + "()\n"
      replacement += object ? ".environmentObject(" + variable + ")" : ".environment(" + variable + ")"
    }
    if projections.isEmpty { replacement = "Group { " + body.2 + " }" }
    else { scan.replacements.append((body.3, body.3, declarations + "\n@Environment(\\.canvasProjection) private var _canvasProjection\n@ViewBuilder private var _canvasOriginalBody: some View {\n" + body.2 + "\n}\n")) }
    for scene in ownedScenes {
      let id = String(data: try! JSONSerialization.data(withJSONObject: scene["id"]!, options: [.fragmentsAllowed, .withoutEscapingSlashes]), encoding: .utf8)!
      let selector = scene["selector"] as! String
      let values = (scene["cases"] as! [String: String]).keys.sorted().map { "\"" + $0 + "\": " + $0 }.joined(separator: ", ")
      replacement += ".modifier(CanvasSceneSelection<" + (scene["type"] as! String) + ">(id: " + id + ", selection: Binding(get: { " + selector + " }, set: { " + selector + " = $0 }), values: [" + values + "]))"
    }
    scan.replacements.append((body.0, body.1, replacement))
  }
  var bytes = Array(code.utf8)
  for (start, end, replacement) in scan.replacements.sorted(by: { $0.0 > $1.0 }) {
    bytes.replaceSubrange(start..<end, with: replacement.utf8)
  }
  // Adapt after preview/projection edits so nested source ranges never overlap.
  let motion = MotionScan(viewMode: .sourceAccurate)
  if coreMotion {
    motion.walk(Parser.parse(source: String(decoding: bytes, as: UTF8.self)))
    for (start, end, replacement) in motion.replacements.sorted(by: { $0.0 > $1.0 }) {
      bytes.replaceSubrange(start..<end, with: replacement.utf8)
    }
  }
  let surface = PreviewSurfaceScan(imagesEnabled: tree.statements.contains(where: { $0.item.as(ImportDeclSyntax.self)?.path.trimmedDescription == "Kingfisher" }))
  surface.walk(Parser.parse(source: String(decoding: bytes, as: UTF8.self)))
  for (start, end, replacement) in surface.replacements.sorted(by: { $0.0 > $1.0 }) {
    bytes.replaceSubrange(start..<end, with: replacement.utf8)
  }
  results.append(["path": input["path"]!, "main": scan.hasMain, "previews": scan.previews, "views": scan.views, "motionAdapter": !motion.replacements.isEmpty, "imageAdapter": surface.imageCalls > 0, "boundsAdapter": surface.boundsCalls > 0,
                  "declarations": flow.declarations, "extensions": flow.extensions, "calls": flow.calls, "boundaries": flow.boundaries, "properties": flow.properties,
                  "compiledSource": "import UIKit\n" + String(decoding: bytes, as: UTF8.self)])
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
