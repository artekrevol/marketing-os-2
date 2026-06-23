#!/usr/bin/env python3
"""
Script to read the All Keywords.xlsx file and prepare the data for import
This will export the data as a JSON file that can be imported using the import_keywords.js script
"""

import pandas as pd
import json
import os

def process_excel_file():
    """
    Read the Excel file and transform the data into the format needed for import
    """
    print("Reading the Excel file...")
    excel_file = "./attached_assets/All Keywords .xlsx"
    
    if not os.path.exists(excel_file):
        print(f"Error: File not found: {excel_file}")
        return
    
    try:
        # Read the Excel file, handle potentially multiple sheets
        xlsx = pd.ExcelFile(excel_file)
        sheet_names = xlsx.sheet_names
        print(f"Found {len(sheet_names)} sheets: {', '.join(sheet_names)}")
        
        keywords = []
        
        # Process Location Keywords sheet
        location_sheet = sheet_names[0]  # First sheet is Location
        df_locations = pd.read_excel(excel_file, sheet_name=location_sheet)
        
        print(f"\nProcessing Location sheet: {location_sheet}")
        print(f"Columns in the sheet: {', '.join(df_locations.columns)}")
        print("\nFirst 5 rows of Location data:")
        print(df_locations.head(5))
        
        # Map location names to IDs based on the known locations
        location_map = {
            "houston": 1,  # Houston - TX,US
            "miami": 2,    # Miami - FL,US 
            "new york": 3, # New York - NY,US
            "los angeles": 4, # Los Angeles - CA,US
            "chicago": 5,  # Chicago - IL,US
            "san francisco": 6, # San Francisco - CA,US
            "washington": 7, # Washington - CO,US
            "austin": 8,   # Austin - TX,CA
            "uae": 9       # UAE - UAE
        }
        
        # Get target URL and keyword column
        target_column = "Target Page"
        keyword_column = "Location Keywords"
        
        # Process location keywords
        for _, row in df_locations.iterrows():
            keyword = row[keyword_column]
            
            # Skip empty keywords
            if pd.isna(keyword) or str(keyword).strip() == "":
                continue
                
            target_url = row[target_column] if not pd.isna(row[target_column]) else ""
            
            # Determine location ID from keyword
            location_id = None
            for location_name, loc_id in location_map.items():
                if location_name.lower() in keyword.lower():
                    location_id = loc_id
                    break
                    
            # Default to Houston if no location found
            if location_id is None:
                location_id = 1  # Houston
                
            keywords.append({
                "keyword": str(keyword).strip(),
                "locationId": location_id,
                "targetUrl": str(target_url).strip() if target_url else "",
                "groupId": 1  # Location Keywords group
            })
        
        # Process Competitor Keywords sheet
        competitor_sheet = sheet_names[1]  # Second sheet is Competitors keywords
        df_competitors = pd.read_excel(excel_file, sheet_name=competitor_sheet)
        
        print(f"\nProcessing Competitor sheet: {competitor_sheet}")
        print(f"Columns in the sheet: {', '.join(df_competitors.columns)}")
        print("\nFirst 5 rows of Competitor data:")
        print(df_competitors.head(5))
        
        # Find the competitor keywords column
        competitor_column = next((col for col in df_competitors.columns 
                                if "competitor" in col.lower() or "keyword" in col.lower()), 
                               df_competitors.columns[0])
        
        # Process competitor keywords
        for _, row in df_competitors.iterrows():
            keyword = row[competitor_column]
            
            # Skip empty keywords
            if pd.isna(keyword) or str(keyword).strip() == "":
                continue
                
            # Competitor keywords don't have a location or target URL
            keywords.append({
                "keyword": str(keyword).strip(),
                "locationId": None,
                "targetUrl": "",
                "groupId": 2  # Competitor Keywords group
            })
        
        # Save to JSON file
        output_file = "keywords_import.json"
        with open(output_file, "w") as f:
            json.dump(keywords, f, indent=2)
        
        print(f"\nSuccessfully processed {len(keywords)} keywords.")
        print(f"Data saved to {output_file}")
        
        # Print sample of the processed data
        print("\nSample of processed data (first 3 entries):")
        for kw in keywords[:3]:
            print(kw)
            
        # Count by group
        location_keywords = [kw for kw in keywords if kw["groupId"] == 1]
        competitor_keywords = [kw for kw in keywords if kw["groupId"] == 2]
        
        print(f"\nTotal keywords by group:")
        print(f"Location Keywords: {len(location_keywords)}")
        print(f"Competitor Keywords: {len(competitor_keywords)}")
        
        # Count by location
        location_counts = {}
        for kw in location_keywords:
            location_id = kw["locationId"]
            location_counts[location_id] = location_counts.get(location_id, 0) + 1
            
        print(f"\nLocation Keywords by location:")
        for loc_id, count in location_counts.items():
            print(f"Location ID {loc_id}: {count} keywords")
            
    except Exception as e:
        print(f"Error processing Excel file: {str(e)}")

if __name__ == "__main__":
    process_excel_file()