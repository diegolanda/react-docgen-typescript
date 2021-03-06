import * as ts from 'typescript';
import { navigate } from './nodeUtils';
import {
    MemberType,
    VariableEntry,
    VeriableKind,
    InterfaceEntry,
    ClassEntry,
    PropertyEntry
} from './model';

/** 
 * Checks if the node is exported. 
 */
function isNodeExported(node: ts.Node): boolean {
    // Parse the modifier array for the export keyword. If it is found
    // and the node.parent is a sourcefile, return true
    // This only returns top level exports
    const { modifiers } = node;
    if (modifiers) {
        for (let i = 0; i < (modifiers as Array<any>).length; i++) {
            if (modifiers[i].kind === ts.SyntaxKind.ExportKeyword) {
                return node.parent.kind === ts.SyntaxKind.SourceFile
            }
        }
    }
    return false;
}

function getType(prop: ts.PropertySignature): MemberType {
    const unionType = prop.type as ts.UnionTypeNode;
    if (unionType && unionType.types) {
        return {
            type: 'string',
            values: (unionType.types as Array<any>).map(i => i.getText()),
        }
    }
    //noinspection TypeScriptUnresolvedFunction
    return {
        type: prop.type.getText(),
    }
}

function getMethods(checker: ts.TypeChecker, type: ts.Type, classDeclaratinNode: ts.ClassDeclaration) {
    return classDeclaratinNode.members
        .map(i => ({ name: i.name.getText() }));
}

function getProperties(checker: ts.TypeChecker, type: ts.Type, interfaceDeclaratinNode: ts.InterfaceDeclaration): PropertyEntry[] {
    
    return type.getProperties() 
        .filter(i => i.valueDeclaration.parent === interfaceDeclaratinNode)
        .map(i => {
            const symbol = checker.getSymbolAtLocation(i.valueDeclaration.name);
            const prop = i.valueDeclaration as ts.PropertySignature;                        
            const typeInfo = getType(prop);
            return {
                name: i.getName(),
                // text: i.valueDeclaration.getText(),
                type: typeInfo.type,
                values: typeInfo.values || [],
                isRequired: !prop.questionToken,
                comment: ts.displayPartsToString(symbol.getDocumentationComment()).trim(),
            };
        });
}

function findAllNodes(rootNode: ts.Node, result: ts.Node[]) {
    result.push(rootNode);
    ts.forEachChild(rootNode, (node) => {
        findAllNodes(node, result);
    });
}

/** 
 * Transform source file AST (abstract syntax tree) to our 
 * model (classes, interfaces, variables, methods).
 */
export function transformAST(sourceFile: ts.SourceFile, checker: ts.TypeChecker) {    
    const nodes = [];
    findAllNodes(sourceFile, nodes);
    
    const variables: VariableEntry[] = nodes
        .filter(i => i.kind === ts.SyntaxKind.VariableStatement)
        .map(i => i as ts.VariableStatement)
        .filter(i => i.declarationList.declarations 
            && i.declarationList.declarations.length === 1
            && i.declarationList.declarations[0].name.kind === ts.SyntaxKind.Identifier)
        .map(i => {
            const d = i.declarationList.declarations[0] as ts.VariableDeclaration;
            const identifier = d.name as ts.Identifier;
            const symbol = checker.getSymbolAtLocation(identifier);
            let arrowFunctionType: string = null;                
            let literalFlags: ts.TypeFlags = null;
            let kind: VeriableKind = 'unknown';
            const varType = checker.getTypeAtLocation(d);

            const initializerType = checker.getTypeAtLocation(d.initializer);
            const initializerFlags = initializerType.flags;
            let arrowFunctionParams = [];
            let callExpressionArguments = [];
            if (d.initializer.kind === ts.SyntaxKind.ArrowFunction) {
                const arrowFunc = d.initializer as ts.ArrowFunction; 
                if (arrowFunc.parameters) {
                    arrowFunctionParams = arrowFunc.parameters.map(i => i.type.getText())
                }
                arrowFunctionType = arrowFunc.type ? arrowFunc.type.getText() : 'undefined';
                kind = 'arrowFunction'
            } else if (d.initializer.kind === ts.SyntaxKind.FirstLiteralToken) {
                const literal = d.initializer as ts.LiteralExpression;                    
                kind = 'literal';
            } else if (d.initializer.kind === ts.SyntaxKind.CallExpression) {
                kind = 'callExpression';
                const callExpresson = d.initializer as ts.CallExpression;
                if (callExpresson.arguments) {
                    callExpressionArguments = callExpresson.arguments.map(i => i.getText());
                }
            }

            return { 
                name: identifier.text,
                exported: isNodeExported(i),
                comment: symbol ? ts.displayPartsToString(symbol.getDocumentationComment()).trim() : '',
                kind,
                type: varType.symbol ? varType.symbol.getName() : null,
                arrowFunctionType,
                arrowFunctionParams,
                callExpressionArguments,
                literalFlags,
                initializerFlags,
            };
        });
    
    const interfaces: InterfaceEntry[] = nodes
        .filter(i => i.kind === ts.SyntaxKind.InterfaceDeclaration)
        .map(i => i as ts.InterfaceDeclaration)
        .map(i => {
            const symbol = checker.getSymbolAtLocation(i.name);
            const type = checker.getTypeAtLocation(i.name);
            return {
                name: symbol.name,
                comment: ts.displayPartsToString(symbol.getDocumentationComment()).trim(),
                exported: isNodeExported(i),
                properties: getProperties(checker, type, i),
            };
        });

    const classes: ClassEntry[] = nodes
        .filter(i => i.kind === ts.SyntaxKind.ClassDeclaration)
        .map(i => i as ts.ClassDeclaration)
        .map(i => {
            const symbol = checker.getSymbolAtLocation(i.name);
            const type = checker.getTypeAtLocation(i.name);
            const baseTypes = type.getBaseTypes();
            let baseType = null;
            if (baseTypes.length) {
                const t = baseTypes[0];
                const typeArguments = navigate(i,
                    ts.SyntaxKind.HeritageClause,
                    ts.SyntaxKind.ExpressionWithTypeArguments) as ts.ExpressionWithTypeArguments;
                baseType = {
                    name: t.symbol.getName(),
                    typeArguments: typeArguments ? typeArguments.typeArguments.map(t => t.getText()) : []
                };
            }

            return {
                name: symbol.name,
                exported: isNodeExported(i),
                baseType: baseType,
                comment: ts.displayPartsToString(symbol.getDocumentationComment()).trim(),
                methods: getMethods(checker, type, i),
            };
        });

        return {
            classes,
            interfaces,
            variables,
        }
}
