// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A verbatim SUBSET of a real NodeSet2 exported by SiOME 3.0.2 (`Opc.Ua.CC.NodeSet_v1.1`,
 * namespace `http://framatome.com/UA/msp`): the parameter/config/range/processing types,
 * two of its 24 `Pnn` instances, and the two objects a NodeSet always carries about
 * ITSELF (the namespace metadata and a DataType encoding).
 *
 * Kept because this one file exposed four independent defects in the reader, each of
 * which alone turns a catalog into nonsense — see `nodeset.spec.ts` and NOTES:
 *
 *  1. its hierarchy is written on the CHILD (`IsForward="false"`), not on the parent;
 *  2. sub-OBJECTS are attached with `Organizes`, while their variables use
 *     `HasComponent` — so following components only left every `Config` unattached;
 *  3. the type's nested declarations (`Config`, `RawRange`, `Processing`) carry a
 *     modelling rule, but the INSTANCE's do not, and both live under a type;
 *  4. one component type (`CCRangeType`) is used twice per instance
 *     (`RawRange`, `EngRange`).
 *
 * Node ids and reference directions are UNCHANGED from the export: the value of this
 * fixture is that nothing in it was tidied up.
 */

export const CC_NODESET_XML = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
    <NamespaceUris>
        <Uri>http://framatome.com/UA/msp</Uri>
    </NamespaceUris>
    <Aliases>
        <Alias Alias="Boolean">i=1</Alias>
        <Alias Alias="UInt16">i=5</Alias>
        <Alias Alias="UInt32">i=7</Alias>
        <Alias Alias="UInt64">i=9</Alias>
        <Alias Alias="Double">i=11</Alias>
        <Alias Alias="DateTime">i=13</Alias>
        <Alias Alias="String">i=12</Alias>
        <Alias Alias="HasComponent">i=47</Alias>
        <Alias Alias="HasProperty">i=46</Alias>
        <Alias Alias="Organizes">i=35</Alias>
        <Alias Alias="HasSubtype">i=45</Alias>
        <Alias Alias="HasTypeDefinition">i=40</Alias>
        <Alias Alias="HasModellingRule">i=37</Alias>
        <Alias Alias="HasEncoding">i=38</Alias>
    </Aliases>

    <!-- The file's own bookkeeping: NamespaceMetadataType (i=11616). NOT a machine. -->
    <UAObject NodeId="ns=1;i=5000" BrowseName="1:http://framatome.com/UA/msp" ParentNodeId="i=11715">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">i=11715</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=11616</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="String" NodeId="ns=1;i=6002" BrowseName="NamespaceUri" ParentNodeId="ns=1;i=5000">
        <References>
            <Reference ReferenceType="HasProperty" IsForward="false">ns=1;i=5000</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=68</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="String" NodeId="ns=1;i=6003" BrowseName="NamespaceVersion" ParentNodeId="ns=1;i=5000">
        <References>
            <Reference ReferenceType="HasProperty" IsForward="false">ns=1;i=5000</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=68</Reference>
        </References>
    </UAVariable>
    <!-- …and a DataType encoding (i=76), likewise not a machine. -->
    <UAObject SymbolicName="DefaultBinary" NodeId="ns=1;i=5029" BrowseName="Default Binary">
        <References>
            <Reference ReferenceType="HasTypeDefinition">i=76</Reference>
        </References>
    </UAObject>

    <!-- ---------------- the types ---------------- -->
    <UAObjectType NodeId="ns=1;i=1000" BrowseName="1:CCParameterType">
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=58</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6070</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6071</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6078</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6079</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5012</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6044</Reference>
        </References>
    </UAObjectType>
    <UAObjectType NodeId="ns=1;i=1002" BrowseName="1:AcquisitionConfigType">
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=58</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6013</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5019</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5020</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5011</Reference>
        </References>
    </UAObjectType>
    <UAObjectType NodeId="ns=1;i=1005" BrowseName="1:CCRangeType">
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=58</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6049</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6050</Reference>
        </References>
    </UAObjectType>
    <UAObjectType NodeId="ns=1;i=1006" BrowseName="1:CCProcessingConfigType">
        <References>
            <Reference ReferenceType="HasSubtype" IsForward="false">i=58</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6058</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6059</Reference>
        </References>
    </UAObjectType>

    <!-- the types' member declarations -->
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6013" BrowseName="1:SampleRate" ParentNodeId="ns=1;i=1002" AccessLevel="3">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6049" BrowseName="1:MinimumValue" ParentNodeId="ns=1;i=1005" AccessLevel="3">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6050" BrowseName="1:MaximumValue" ParentNodeId="ns=1;i=1005" AccessLevel="3">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="UInt16" NodeId="ns=1;i=6058" BrowseName="1:Function" ParentNodeId="ns=1;i=1006" AccessLevel="3">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6059" BrowseName="1:WindowSize" ParentNodeId="ns=1;i=1006" AccessLevel="3">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="UInt64" NodeId="ns=1;i=6070" BrowseName="1:SampleIndex" ParentNodeId="ns=1;i=1000">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6071" BrowseName="1:SampleValue" ParentNodeId="ns=1;i=1000" AccessLevel="5">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="String" NodeId="ns=1;i=6078" BrowseName="1:Name" ParentNodeId="ns=1;i=1000">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6079" BrowseName="1:ParameterIndex" ParentNodeId="ns=1;i=1000">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6044" BrowseName="1:EngValue" ParentNodeId="ns=1;i=1000">
        <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
    </UAVariable>

    <!-- the types' nested instance DECLARATIONS (these DO carry a modelling rule) -->
    <UAObject NodeId="ns=1;i=5012" BrowseName="1:Config" ParentNodeId="ns=1;i=1000">
        <References>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1002</Reference>
            <Reference ReferenceType="HasModellingRule">i=78</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5020</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5011</Reference>
            <Reference ReferenceType="Organizes">ns=1;i=5019</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6013</Reference>
        </References>
    </UAObject>
    <UAObject NodeId="ns=1;i=5019" BrowseName="1:RawRange" ParentNodeId="ns=1;i=1002">
        <References>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1005</Reference>
            <Reference ReferenceType="HasModellingRule">i=78</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6050</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6049</Reference>
        </References>
    </UAObject>
    <UAObject NodeId="ns=1;i=5020" BrowseName="1:EngRange" ParentNodeId="ns=1;i=1002">
        <References>
            <Reference ReferenceType="HasModellingRule">i=78</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=58</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6050</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6049</Reference>
        </References>
    </UAObject>
    <UAObject NodeId="ns=1;i=5011" BrowseName="1:Processing" ParentNodeId="ns=1;i=1002">
        <References>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1006</Reference>
            <Reference ReferenceType="HasModellingRule">i=78</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6058</Reference>
            <Reference ReferenceType="HasComponent">ns=1;i=6059</Reference>
        </References>
    </UAObject>

    <!-- ---------------- P01: a real instance ---------------- -->
    <UAObject NodeId="ns=1;i=5018" BrowseName="1:P01" ParentNodeId="i=85">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">i=85</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1000</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6087" BrowseName="1:ParameterIndex" ParentNodeId="ns=1;i=5018">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="String" NodeId="ns=1;i=6088" BrowseName="1:Name" ParentNodeId="ns=1;i=5018">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="UInt64" NodeId="ns=1;i=6096" BrowseName="1:SampleIndex" ParentNodeId="ns=1;i=5018">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6097" BrowseName="1:SampleValue" ParentNodeId="ns=1;i=5018" AccessLevel="5">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Boolean" NodeId="ns=1;i=6098" BrowseName="1:StartAcq" ParentNodeId="ns=1;i=5018" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6156" BrowseName="1:EngValue" ParentNodeId="ns=1;i=5018">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5015" BrowseName="1:Config" ParentNodeId="ns=1;i=5018">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5018</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1002</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6047" BrowseName="1:SampleRate" ParentNodeId="ns=1;i=5015" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5015</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5017" BrowseName="1:EngRange" ParentNodeId="ns=1;i=5015">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5015</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=58</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="Double" NodeId="ns=1;i=6052" BrowseName="1:MaximumValue" ParentNodeId="ns=1;i=5017" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5017</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6053" BrowseName="1:MinimumValue" ParentNodeId="ns=1;i=5017" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5017</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5022" BrowseName="1:Processing" ParentNodeId="ns=1;i=5015">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5015</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1006</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="UInt16" NodeId="ns=1;i=6074" BrowseName="1:Function" ParentNodeId="ns=1;i=5022" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5022</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6075" BrowseName="1:WindowSize" ParentNodeId="ns=1;i=5022" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5022</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5023" BrowseName="1:RawRange" ParentNodeId="ns=1;i=5015">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5015</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1005</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="Double" NodeId="ns=1;i=6076" BrowseName="1:MaximumValue" ParentNodeId="ns=1;i=5023" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5023</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6077" BrowseName="1:MinimumValue" ParentNodeId="ns=1;i=5023" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5023</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>

    <!-- ---------------- P02: the same shape, its own node ids ---------------- -->
    <UAObject NodeId="ns=1;i=5038" BrowseName="1:P02" ParentNodeId="i=85">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">i=85</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1000</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6133" BrowseName="1:ParameterIndex" ParentNodeId="ns=1;i=5038">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="String" NodeId="ns=1;i=6134" BrowseName="1:Name" ParentNodeId="ns=1;i=5038">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="UInt64" NodeId="ns=1;i=6136" BrowseName="1:SampleIndex" ParentNodeId="ns=1;i=5038">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6137" BrowseName="1:SampleValue" ParentNodeId="ns=1;i=5038" AccessLevel="5">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Boolean" NodeId="ns=1;i=6138" BrowseName="1:StartAcq" ParentNodeId="ns=1;i=5038" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6157" BrowseName="1:EngValue" ParentNodeId="ns=1;i=5038">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5016" BrowseName="1:Config" ParentNodeId="ns=1;i=5038">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5038</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1002</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6051" BrowseName="1:SampleRate" ParentNodeId="ns=1;i=5016" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5016</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5027" BrowseName="1:EngRange" ParentNodeId="ns=1;i=5016">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5016</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=58</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="Double" NodeId="ns=1;i=6101" BrowseName="1:MaximumValue" ParentNodeId="ns=1;i=5027" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5027</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6105" BrowseName="1:MinimumValue" ParentNodeId="ns=1;i=5027" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5027</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5031" BrowseName="1:Processing" ParentNodeId="ns=1;i=5016">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5016</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1006</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="UInt16" NodeId="ns=1;i=6111" BrowseName="1:Function" ParentNodeId="ns=1;i=5031" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5031</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="UInt32" NodeId="ns=1;i=6117" BrowseName="1:WindowSize" ParentNodeId="ns=1;i=5031" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5031</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAObject NodeId="ns=1;i=5032" BrowseName="1:RawRange" ParentNodeId="ns=1;i=5016">
        <References>
            <Reference ReferenceType="Organizes" IsForward="false">ns=1;i=5016</Reference>
            <Reference ReferenceType="HasTypeDefinition">ns=1;i=1005</Reference>
        </References>
    </UAObject>
    <UAVariable DataType="Double" NodeId="ns=1;i=6118" BrowseName="1:MaximumValue" ParentNodeId="ns=1;i=5032" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5032</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
    <UAVariable DataType="Double" NodeId="ns=1;i=6119" BrowseName="1:MinimumValue" ParentNodeId="ns=1;i=5032" AccessLevel="3">
        <References>
            <Reference ReferenceType="HasComponent" IsForward="false">ns=1;i=5032</Reference>
            <Reference ReferenceType="HasTypeDefinition">i=63</Reference>
        </References>
    </UAVariable>
</UANodeSet>`;
