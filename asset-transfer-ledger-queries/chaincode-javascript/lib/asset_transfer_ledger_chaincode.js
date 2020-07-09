/*
 SPDX-License-Identifier: Apache-2.0
*/

// ====CHAINCODE EXECUTION SAMPLES (CLI) ==================

// ==== Invoke assets ====
// peer chaincode invoke -C CHANNEL_NAME -n asset_transfer -c '{"Args":["createAsset","asset1","blue","tom","35","100"]}'
// peer chaincode invoke -C CHANNEL_NAME -n asset_transfer -c '{"Args":["createAsset","asset2","red","tom","50","150"]}'
// peer chaincode invoke -C CHANNEL_NAME -n asset_transfer -c '{"Args":["createAsset","asset3","blue","tom","70","200"]}'
// peer chaincode invoke -C CHANNEL_NAME -n asset_transfer -c '{"Args":["transferAsset","asset2","jerry"]}'
// peer chaincode invoke -C CHANNEL_NAME -n asset_transfer -c '{"Args":["transferAssetsBasedOnColor","blue","jerry"]}'
// peer chaincode invoke -C CHANNEL_NAME -n asset_transfer -c '{"Args":["deleteAsset","asset1"]}'

// ==== Query assets ====
// peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["readAsset","asset1"]}'
// peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["getAssetsByRange","asset1","asset3"]}' output issue go
// peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["getAssetHistory","asset1"]}'

// Rich Query (Only supported if CouchDB is used as state database):
// peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["queryAssetsByOwner","tom"]}' output issue
// peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["queryAssets","{\"selector\":{\"owner\":\"tom\"}}"]}' output issue go

// Rich Query with Pagination (Only supported if CouchDB is used as state database):
// peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["queryAssetsWithPagination","{\"selector\":{\"owner\":\"tom\"}}","3",""]}' //error: invalid bookmark

// INDEXES TO SUPPORT COUCHDB RICH QUERIES
//
// Indexes in CouchDB are required in order to make JSON queries efficient and are required for
// any JSON query with a sort. Indexes may be packaged alongside
// chaincode in a META-INF/statedb/couchdb/indexes directory. Each index must be defined in its own
// text file with extension *.json with the index definition formatted in JSON following the
// CouchDB index JSON syntax as documented at:
// http://docs.couchdb.org/en/2.3.1/api/database/find.html#db-index
//
// This asset transfer ledger example chaincode demonstrates a packaged
// index which you can find in META-INF/statedb/couchdb/indexes/indexOwner.json.
//
// If you have access to the your peer's CouchDB state database in a development environment,
// you may want to iteratively test various indexes in support of your chaincode queries.  You
// can use the CouchDB Fauxton interface or a command line curl utility to create and update
// indexes. Then once you finalize an index, include the index definition alongside your
// chaincode in the META-INF/statedb/couchdb/indexes directory, for packaging and deployment
// to managed environments.
//
// In the examples below you can find index definitions that support asset transfer ledger
// chaincode queries, along with the syntax that you can use in development environments
// to create the indexes in the CouchDB Fauxton interface or a curl command line utility.
//

// Index for docType, owner.
//
// Example curl command line to define index in the CouchDB channel_chaincode database
// curl -i -X POST -H "Content-Type: application/json" -d "{\"index\":{\"fields\":[\"docType\",\"owner\"]},\"name\":\"indexOwner\",\"ddoc\":\"indexOwnerDoc\",\"type\":\"json\"}" http://hostname:port/myc1_assets/_index
//

// Index for docType, owner, size (descending order).
//
// Example curl command line to define index in the CouchDB channel_chaincode database
// curl -i -X POST -H "Content-Type: application/json" -d "{\"index\":{\"fields\":[{\"size\":\"desc\"},{\"docType\":\"desc\"},{\"owner\":\"desc\"}]},\"ddoc\":\"indexSizeSortDoc\", \"name\":\"indexSizeSortDesc\",\"type\":\"json\"}" http://hostname:port/myc1_assets/_index

// Rich Query with index design doc and index name specified (Only supported if CouchDB is used as state database):
//   peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["queryAssets","{\"selector\":{\"docType\":\"asset\",\"owner\":\"tom\"}, \"use_index\":[\"_design/indexOwnerDoc\", \"indexOwner\"]}"]}'

// Rich Query with index design doc specified only (Only supported if CouchDB is used as state database):
//   peer chaincode query -C CHANNEL_NAME -n asset_transfer -c '{"Args":["queryAssets","{\"selector\":{\"docType\":{\"$eq\":\"asset\"},\"owner\":{\"$eq\":\"tom\"},\"size\":{\"$gt\":0}},\"fields\":[\"docType\",\"owner\",\"size\"],\"sort\":[{\"size\":\"desc\"}],\"use_index\":\"_design/indexSizeSortDoc\"}"]}'

'use strict';

const { Contract } = require('fabric-contract-api');

class Chaincode extends Contract{

  // CreateAsset - create a new asset, store into chaincode state
  async createAsset(ctx, assetID, color, owner, size, appraisedValue) {
    const exists = await this.assetExists(ctx, assetID)
    if (exists) {
      throw new Error('asset exists')
    }

    // ==== Create asset object and marshal to JSON ====
    let asset = {};
    asset.docType = 'asset';
    asset.ID = assetID;
    asset.color = color;
    asset.size = size;
    asset.owner = owner;
    asset.appraisedValue = appraisedValue;

    // === Save asset to state ===
    await ctx.stub.putState(assetID, Buffer.from(JSON.stringify(asset)));
    let indexName = 'color~name'
    let colorNameIndexKey = await ctx.stub.createCompositeKey(indexName, [asset.color, asset.ID]);

    //  Save index entry to state. Only the key name is needed, no need to store a duplicate copy of the marble.
    //  Note - passing a 'nil' value will effectively delete the key from state, therefore we pass null character as value
    await ctx.stub.putState(colorNameIndexKey, Buffer.from('\u0000'));
  }

  // readAsset returns the asset stored in the world state with given id.
  async readAsset(ctx, id) {
    const assetJSON = await ctx.stub.getState(id); // get the asset from chaincode state
    if (!assetJSON || assetJSON.length === 0) {
        throw new Error(`The asset ${id} does not exist`);
    }

    return assetJSON.toString();
  }

  // delete - remove a asset key/value pair from state
  async deleteAsset(ctx, id) {
    if (!id) {
      throw new Error('asset name must not be empty');
    }

    var exists = await this.assetExists(ctx, id)
    if (!exists) {
      throw new Error('')
    }

    // to maintain the color~name index, we need to read the asset first and get its color
    let valAsbytes = await ctx.stub.getState(id); // get the asset from chaincode state
    let jsonResp = {};
    if (!valAsbytes) {
      jsonResp.error = 'asset does not exist: ' + name;
      throw new Error(jsonResp);
    }
    let assetJSON = {};
    try {
      assetJSON = JSON.parse(valAsbytes.toString());
    } catch (err) {
      jsonResp = {};
      jsonResp.error = 'Failed to decode JSON of: ' + id;
      throw new Error(jsonResp);
    }
    await ctx.stub.deleteState(id); //remove the asset from chaincode state

    // delete the index
    let indexName = 'color~name';
    let colorNameIndexKey = ctx.stub.createCompositeKey(indexName, [assetJSON.color, assetJSON.ID]);
    if (!colorNameIndexKey) {
      throw new Error(' Failed to create the createCompositeKey');
    }
    //  Delete index entry to state.
    await ctx.stub.deleteState(colorNameIndexKey);
  }

  // TransferAsset transfers a asset by setting a new owner name on the asset
  async transferAsset(ctx, assetName, newOwner) {

    let assetAsBytes = await ctx.stub.getState(assetName);
    if (!assetAsBytes || !assetAsBytes.toString()) {
      throw new Error('asset does not exist');
    }
    let assetToTransfer = {};
    try {
      assetToTransfer = JSON.parse(assetAsBytes.toString()); //unmarshal
    } catch (err) {
      let jsonResp = {};
      jsonResp.error = 'Failed to decode JSON of: ' + assetName;
      throw new Error(jsonResp);
    }
    assetToTransfer.owner = newOwner; //change the owner

    let assetJSONasBytes = Buffer.from(JSON.stringify(assetToTransfer));
    await ctx.stub.putState(assetName, assetJSONasBytes); //rewrite the asset
  }

// GetAssetsByRange performs a range query based on the start and end keys provided.
// Read-only function results are not typically submitted to ordering. If the read-only
// results are submitted to ordering, or if the query is used in an update transaction
// and submitted to ordering, then the committing peers will re-execute to guarantee that
// result sets are stable between endorsement time and commit time. The transaction is
// invalidated by the committing peers if the result set has changed between endorsement
// time and commit time.
// Therefore, range queries are a safe option for performing update transactions based on query results.
  async getAssetsByRange(ctx, startKey, endKey) {

    let resultsIterator = await ctx.stub.getStateByRange(startKey, endKey);
    let results = await this.getAllResults(resultsIterator, false);

    return JSON.stringify(results);
  }

  // TransferAssetBasedOnColor will transfer assets of a given color to a certain new owner.
  // Uses a GetStateByPartialCompositeKey (range query) against color~name 'index'.
  // Committing peers will re-execute range queries to guarantee that result sets are stable
  // between endorsement time and commit time. The transaction is invalidated by the
  // committing peers if the result set has changed between endorsement time and commit time.
  // Therefore, range queries are a safe option for performing update transactions based on query results.
  // Example: GetStateByPartialCompositeKey/RangeQuery
  async transferAssetsBasedOnColor(ctx, color, newOwner) {
    // Query the color~name index by color
    // This will execute a key range query on all keys starting with 'color'
    let coloredAssetResultsIterator = await ctx.stub.getStateByPartialCompositeKey('color~name', [color]);

    // Iterate through result set and for each asset found, transfer to newOwner
    while (true) {
      let responseRange = await coloredAssetResultsIterator.next();
      if (!responseRange || !responseRange.value || !responseRange.value.key) {
        return;
      }

      let objectType;
      let attributes;
      ({
        objectType,
        attributes
      } = await ctx.stub.splitCompositeKey(responseRange.value.key));

      let returnedColor = attributes[0];
      let returnedAssetName = attributes[1];

      // Now call the transfer function for the found asset.
      // Re-use the same function that is used to transfer individual assets
      let response = await this.transferAsset(ctx, returnedAssetName, newOwner);
    }
  }

  // QueryAssetsByOwner queries for assets based on a passed in owner.
  // This is an example of a parameterized query where the query logic is baked into the chaincode,
  // and accepting a single query parameter (owner).
  // Only available on state databases that support rich query (e.g. CouchDB)
  // Example: Parameterized rich query
  async queryAssetsByOwner(ctx, owner) {
    let queryString = {};
    queryString.selector = {};
    queryString.selector.docType = 'asset';
    queryString.selector.owner = owner;
    let queryResults = await this.getQueryResultForQueryString(ctx, JSON.stringify(queryString));
    return queryResults; //shim.success(queryResults);
  }

  // Example: Ad hoc rich query
  // queryAssets uses a query string to perform a query for assets.
  // Query string matching state database syntax is passed in and executed as is.
  // Supports ad hoc queries that can be defined at runtime by the client.
  // If this is not desired, follow the queryAssetsForOwner example for parameterized queries.
  // Only available on state databases that support rich query (e.g. CouchDB)
  async queryAssets(ctx, queryString) {
    let queryResults = await this.getQueryResultForQueryString(ctx, queryString);
    return queryResults;
  }

  // getQueryResultForQueryString executes the passed in query string.
  // Result set is built and returned as a byte array containing the JSON results.
  async getQueryResultForQueryString(ctx, queryString) {
    
    let resultsIterator = await ctx.stub.getQueryResult(queryString);
    let results = await this.getAllResults(resultsIterator, false);

    return JSON.stringify(results);
  }

  // Example: Pagination with Range Query
  // GetAssetsByRangeWithPagination performs a range query based on the start & end key,
  // page size and a bookmark.
  // The number of fetched records will be equal to or lesser than the page size.
  // Paginated range queries are only valid for read only transactions.
  async getAssetsByRangeWithPagination(ctx, startKey, endKey, pageSize, bookmark) {
    
    const { iterator, metadata } = await ctx.stub.getStateByRangeWithPagination(startKey, endKey, pageSize, bookmark);
    const results = await this.getAllResults(iterator, false);

    results.ResponseMetadata = {
      RecordsCount: metadata.fetched_records_count,
      Bookmark: metadata.bookmark,
    };
    return JSON.stringify(results);
  }

  // Example: Pagination with Ad hoc Rich Query
  // QueryAssetsWithPagination uses a query string, page size and a bookmark to perform a query
  // for assets. Query string matching state database syntax is passed in and executed as is.
  // The number of fetched records would be equal to or lesser than the specified page size.
  // Supports ad hoc queries that can be defined at runtime by the client.
  // If this is not desired, follow the QueryAssetsForOwner example for parameterized queries.
  // Only available on state databases that support rich query (e.g. CouchDB)
  // Paginated queries are only valid for read only transactions.
  async queryAssetsWithPagination(ctx, queryString, pageSize, bookmark) {

    const { iterator, metadata } = await ctx.stub.getQueryResultWithPagination(queryString, pageSize, bookmark);
    const results = await this.getAllResults(iterator, false);

    results.ResponseMetadata = {
      RecordsCount: metadata.fetched_records_count,
      Bookmark: metadata.bookmark,
    };

    return JSON.stringify(results);
  }

  // GetAssetHistory returns the chain of custody for an asset since issuance.
  async getAssetHistory(ctx, assetName) {

    let resultsIterator = await ctx.stub.getHistoryForKey(assetName);
    let results = await this.getAllResults(resultsIterator, true);

    return JSON.stringify(results);
  }

  // AssetExists returns true when asset with given ID exists in world state
  async assetExists(ctx, assetName) {
    // ==== Check if asset already exists ====
    let assetState = await ctx.stub.getState(assetName);
    if ( !assetState || assetState.length === 0 ) {
      return false;
    }
    return true
  }

  // getAllAssets returns all assets found in the world state.
  async getAllAssets(ctx) {
    const allResults = [];
    // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
    for await (const { key, value } of ctx.stub.getStateByRange("", "")) {
        const strValue = Buffer.from(value).toString('utf8');
        let record;
        try {
            record = JSON.parse(strValue);
        } catch (err) {
            console.log(err);
            record = strValue;
        }
        allResults.push({ Key: key, Record: record });
    }
    return JSON.stringify(allResults);
  }

  async getAllResults(iterator, isHistory) {
    let allResults = [];
    while (true) {
      let res = await iterator.next();

      if (res.value && res.value.value.toString()) {
        let jsonRes = {};
        console.log(res.value.value.toString('utf8'));
        if (isHistory && isHistory === true) {
          jsonRes.TxId = res.value.tx_id;
          jsonRes.Timestamp = res.value.timestamp;
          try {
            jsonRes.Value = JSON.parse(res.value.value.toString('utf8'));
          } catch (err) {
            console.log(err);
            jsonRes.Value = res.value.value.toString('utf8');
          }
        } else {
          jsonRes.Key = res.value.key;
          try {
            jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
          } catch (err) {
            console.log(err);
            jsonRes.Record = res.value.value.toString('utf8');
          }
        }
        allResults.push(jsonRes);
      }
      if (res.done) {
        await iterator.close();
        return allResults;
      }
    }
  }

  // InitLedger creates sample assets in the ledger
  async initLedger(ctx) {
    const assets = [
        {
            ID: 'asset1',
            color: 'blue',
            size: 5,
            owner: 'Tom',
            appraisedValue: 100
        },
        {
            ID: 'asset2',
            color: 'red',
            size: 5,
            owner: 'Brad',
            appraisedValue: 100
        },
        {
            ID: 'asset3',
            color: 'green',
            size: 10,
            owner: 'Jin Soo',
            appraisedValue: 200
        },
        {
            ID: 'asset4',
            color: 'yellow',
            size: 10,
            owner: 'Max',
            appraisedValue: 200
        },
        {
            ID: 'asset5',
            color: 'black',
            size: 15,
            owner: 'Adriana',
            appraisedValue: 250
        },
        {
            ID: 'asset6',
            color: 'white',
            size: 15,
            owner: 'Michel',
            appraisedValue: 250
        },
    ];

    for (let i = 0; i < assets.length; i++) {
        await this.createAsset(
          ctx,
          assets[i].ID,
          assets[i].color,
          assets[i].owner,
          assets[i].size,
          assets[i].appraisedValue
          );
    }
  }
}

module.exports = Chaincode;